import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  CanvasBoardCreateSchema,
  CanvasBoardMutationSchema,
  CanvasObjectCreateSchema,
  type CanvasBoardMutation,
} from "../../packages/contracts/src/index.ts";
import {
  MemoryRepository,
  createCanvasBoardRepository,
  createPlatformRepository,
  type CreatorContext,
} from "../../packages/db/src/index.ts";
import { MemoryCanvasBoards } from "../../packages/db/src/canvas-board-store.ts";
import { CanvasTargetFailure, canvasTargetMarker } from "../load/canvas-target-config.ts";
import { restoreCanvasTargetText } from "../load/canvas-target-restore.ts";

type RestoreInput = Parameters<typeof restoreCanvasTargetText>[0];
const repositories: MemoryRepository[] = [];
afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function principal(repository: MemoryRepository) {
  const tokenHash = randomUUID(),
    now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `canvas-restore-${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "synthetic-test",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const actor = await repository.consumeMagicToken(tokenHash, now);
  if (!actor) throw new Error("Synthetic identity was not created");
  return actor;
}
async function fixture() {
  const repository = new MemoryRepository();
  repositories.push(repository);
  await repository.initialize();
  const owner = await principal(repository),
    editor = await principal(repository),
    platform = createPlatformRepository(repository);
  const organization = await platform.createOrganization({
    name: "Synthetic restore team",
    actorId: owner.userId,
    accountType: "organization",
    licenseUnit: "user",
  });
  await platform.applySubscriptionSnapshot({
    organizationId: organization.id,
    customerId: null,
    subscriptionId: null,
    status: "active",
    licenseQuantity: 2,
    licenseUnit: "user",
    offerId: null,
    paidThrough: null,
    graceUntil: null,
    legacyPlan: "team",
  });
  await platform.setOrganizationMember({
    organizationId: organization.id,
    actorId: owner.userId,
    userId: editor.userId,
    role: "member",
  });
  await platform.assignOrganizationUserLicense(organization.id, owner.userId, editor.userId, true);
  const licenses = await platform.getOrganizationUserLicenses(organization.id, owner.userId),
    workspaceId = licenses.assignments.find(({ userId }) => userId === owner.userId)!.workspaceId;
  expect(licenses.assignments.find(({ userId }) => userId === editor.userId)!.workspaceId).not.toBe(
    workspaceId,
  );
  const canvases = createCanvasBoardRepository(repository);
  let board = await canvases.create(
    owner,
    CanvasBoardCreateSchema.parse({
      schemaVersion: CANVAS_SCHEMA_VERSION,
      workspaceId,
      title: `${canvasTargetMarker} cleanup race`,
      boardType: "team",
      operationId: randomUUID(),
    }),
  );
  const invitation = await canvases.invite(owner, board.id, {
    email: editor.email,
    role: "editor",
    operationId: randomUUID(),
  });
  await canvases.acceptInvitation(editor, invitation.id);
  const objects = [0, 1].map((index) =>
    CanvasObjectCreateSchema.parse({
      id: randomUUID(),
      type: "sticky",
      x: index * 300,
      y: 0,
      width: 240,
      height: 180,
      text: `${canvasTargetMarker} original${index}`,
    }),
  );
  board = (
    await canvases.command(
      owner,
      board.id,
      CanvasBoardMutationSchema.parse({
        schemaVersion: CANVAS_SCHEMA_VERSION,
        operationId: randomUUID(),
        command: {
          type: "batch",
          operations: objects.map((object) => ({ type: "create", object })),
        },
      }),
    )
  ).board;
  const original = { id: objects[0]!.id, text: objects[0]!.text, version: 1 },
    initialSequence = board.canvasSeq;
  const reads: number[] = [],
    attempts: CanvasBoardMutation[] = [],
    accepted: Array<{ operationId: string; canvasSeq: number }> = [];
  const read = async () => {
    const current = await canvases.get(owner, board.id);
    reads.push(current.objects.find(({ id }) => id === original.id)!.version);
    return current;
  };
  const apply = async (mutation: CanvasBoardMutation, actor: CreatorContext = owner) => {
    try {
      return await canvases.command(actor, board.id, mutation);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "STALE_DRAFT")
        throw new CanvasTargetFailure("TARGET_HTTP", 409);
      throw error;
    }
  };
  const write = async (mutation: CanvasBoardMutation) => {
    attempts.push(mutation);
    const result = await apply(mutation);
    accepted.push(result.receipt);
    return result;
  };
  const edit = (
    text: string,
    expectedVersion: number,
    actor: CreatorContext = owner,
    id = original.id,
  ) =>
    apply(
      CanvasBoardMutationSchema.parse({
        schemaVersion: CANVAS_SCHEMA_VERSION,
        operationId: randomUUID(),
        command: {
          type: "batch",
          operations: [{ type: "update", id, expectedVersion, patch: { text } }],
        },
      }),
      actor,
    );
  const input = (overrides: Partial<RestoreInput> = {}): RestoreInput => ({
    original,
    attempted: { text: `${canvasTargetMarker} pending`, version: 2 },
    deadline: performance.now() + 30_000,
    read,
    write,
    ...overrides,
  });
  const current = () => canvases.get(owner, board.id);
  return {
    repository,
    canvases,
    owner,
    editor,
    board,
    original,
    unrelated: objects[1]!,
    initialSequence,
    reads,
    attempts,
    accepted,
    read,
    apply,
    write,
    edit,
    input,
    current,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function version(mutation: CanvasBoardMutation) {
  if (mutation.command.type !== "batch" || mutation.command.operations[0]?.type !== "update")
    throw new Error("Expected a single text fence");
  expect(mutation.command.operations).toHaveLength(1);
  expect(mutation.command.operations[0].patch).toHaveProperty("text");
  return mutation.command.operations[0].expectedVersion;
}
/** Hold before the real repository's version check, just as a delayed HTTP handler can be held. */
function heldFence(f: Fixture, overrides: Partial<RestoreInput> = {}) {
  const entered = deferred<CanvasBoardMutation>(),
    release = deferred<void>();
  let calls = 0;
  const input = f.input({
    ...overrides,
    write: async (mutation) => {
      if (++calls === 1) {
        entered.resolve(mutation);
        await release.promise;
      }
      return (overrides.write ?? f.write)(mutation);
    },
  });
  const result = restoreCanvasTargetText(input);
  void result.catch(() => {});
  return {
    input,
    result,
    release: () => release.resolve(),
    entered: Promise.race([
      entered.promise,
      result.then(() => {
        throw new Error("Restore ended before its first fence");
      }),
    ]),
  };
}

describe("target text cleanup fences real Canvas versions", () => {
  it("does not read or mutate after the cleanup deadline already expired", async () => {
    const f = await fixture();
    await expect(
      restoreCanvasTargetText(f.input({ deadline: performance.now() - 1 })),
    ).resolves.toBe("skipped-cleanup-deadline");
    expect(f.reads).toEqual([]);
    expect(f.attempts).toEqual([]);
    expect((await f.current()).canvasSeq).toBe(f.initialSequence);
  });

  it("fences an unchanged original before releasing the delayed proposal, consuming one cleanup receipt", async () => {
    const f = await fixture(),
      entered = deferred<void>(),
      release = deferred<void>(),
      proposal = f.input().attempted;
    const pending = (async () => {
      entered.resolve();
      await release.promise;
      return f.edit(proposal.text, 1);
    })();
    void pending.catch(() => {});
    try {
      await entered.promise;
      await expect(restoreCanvasTargetText(f.input())).resolves.toBe("fenced-unchanged");
      expect(f.accepted).toHaveLength(1);
      expect(f.attempts.map(version)).toEqual([1]);
      release.resolve();
      await expect(pending).rejects.toMatchObject({ code: "TARGET_HTTP", status: 409 });
      const current = await f.current();
      expect(current.objects.find(({ id }) => id === f.original.id)).toMatchObject({
        ...f.original,
        version: 2,
      });
      expect(current.canvasSeq).toBe(f.initialSequence + 1);
    } finally {
      release.resolve();
      await Promise.allSettled([pending]);
    }
  });

  it("rereads only after a real409 when the own proposal wins, then restores with one accepted cleanup receipt", async () => {
    const f = await fixture(),
      hold = heldFence(f),
      proposal = hold.input.attempted;
    try {
      expect(version(await hold.entered)).toBe(1);
      await f.edit(proposal.text, 1);
      hold.release();
      await expect(hold.result).resolves.toBe("restored");
      expect(f.reads).toEqual([1, 2]);
      expect(f.attempts.map(version)).toEqual([1, 2]);
      expect(new Set(f.attempts.map(({ operationId }) => operationId)).size).toBe(2);
      expect(f.accepted).toHaveLength(1);
      expect((await f.current()).canvasSeq).toBe(f.initialSequence + 2);
      expect((await f.current()).objects.find(({ id }) => id === f.original.id)).toMatchObject({
        text: f.original.text,
        version: 3,
      });
    } finally {
      hold.release();
      await Promise.allSettled([hold.result]);
    }
  });

  it.each([false, true])(
    "protects an acknowledged later wave with a pending successor (proposal wins=%s)",
    async (proposalWins) => {
      const f = await fixture(),
        acknowledged = { text: `${canvasTargetMarker} accepted wave`, version: 2 },
        attempted = { text: `${canvasTargetMarker} pending successor`, version: 3 };
      await f.edit(acknowledged.text, 1);
      if (proposalWins) {
        const hold = heldFence(f, { acknowledged, attempted });
        try {
          await hold.entered;
          await f.edit(attempted.text, 2);
          hold.release();
          await expect(hold.result).resolves.toBe("restored");
        } finally {
          hold.release();
          await Promise.allSettled([hold.result]);
        }
        expect(f.attempts.map(version)).toEqual([2, 3]);
      } else {
        await expect(restoreCanvasTargetText(f.input({ acknowledged, attempted }))).resolves.toBe(
          "restored",
        );
        await expect(f.edit(attempted.text, 2)).rejects.toMatchObject({
          code: "TARGET_HTTP",
          status: 409,
        });
        expect(f.attempts.map(version)).toEqual([2]);
      }
      expect(f.accepted).toHaveLength(1);
      expect((await f.current()).objects.find(({ id }) => id === f.original.id)?.text).toBe(
        f.original.text,
      );
    },
  );

  it.each(["different", "original"])(
    "never overwrites a third-party%s-text edit that wins between read and fence",
    async (kind) => {
      const f = await fixture(),
        hold = heldFence(f),
        thirdParty = kind === "original" ? f.original.text : `${canvasTargetMarker} another editor`;
      try {
        await hold.entered;
        await f.edit(thirdParty, 1, f.editor);
        hold.release();
        await expect(hold.result).resolves.toBe("skipped-conflict");
        expect(f.reads).toEqual([1, 2]);
        expect(f.attempts).toHaveLength(1);
        expect(f.accepted).toHaveLength(0);
        expect((await f.current()).objects.find(({ id }) => id === f.original.id)).toMatchObject({
          text: thirdParty,
          version: 2,
        });
      } finally {
        hold.release();
        await Promise.allSettled([hold.result]);
      }
    },
  );

  it("rejects an original-looking value at an unfamiliar version without writing a fence", async () => {
    const f = await fixture();
    await f.edit(f.original.text, 1, f.editor);
    await expect(restoreCanvasTargetText(f.input())).resolves.toBe("skipped-conflict");
    expect(f.reads).toEqual([2]);
    expect(f.attempts).toHaveLength(0);
  });

  it.each(["timeout", "malformed"])(
    "leaves a%s fence acknowledgement unresolved after actual commit, without another mutation",
    async (kind) => {
      const f = await fixture();
      const result = restoreCanvasTargetText(
        f.input({
          write: async (mutation) => {
            const response = await f.write(mutation);
            if (kind === "timeout") throw new CanvasTargetFailure("TARGET_NETWORK");
            return { ...response, receipt: { ...response.receipt, operationId: randomUUID() } };
          },
        }),
      );
      await expect(result).rejects.toMatchObject({
        code: kind === "timeout" ? "TARGET_NETWORK" : "ACK_INVALID",
      });
      expect(f.reads).toEqual([1]);
      expect(f.attempts).toHaveLength(1);
      expect(f.accepted).toHaveLength(1);
      expect((await f.current()).canvasSeq).toBe(f.initialSequence + 1);
      await expect(f.edit(f.input().attempted.text, 1)).rejects.toMatchObject({
        code: "TARGET_HTTP",
        status: 409,
      });
    },
  );

  it.each([401, 403, 429])("does not reread/retry a%s response", async (status) => {
    const f = await fixture();
    let calls = 0;
    await expect(
      restoreCanvasTargetText(
        f.input({
          write: async () => {
            calls++;
            throw new CanvasTargetFailure("TARGET_HTTP", status);
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "TARGET_HTTP", status });
    expect(calls).toBe(1);
    expect(f.reads).toEqual([1]);
    expect(f.accepted).toHaveLength(0);
    expect((await f.current()).canvasSeq).toBe(f.initialSequence);
  });

  it("does not attempt a third write/read after the second version check conflicts", async () => {
    const f = await fixture();
    let calls = 0;
    const input = f.input({
      write: async (mutation) => {
        if (++calls === 1) await f.edit(f.input().attempted.text, 1);
        else await f.edit(`${canvasTargetMarker} third-party successor`, 2, f.editor);
        return f.write(mutation);
      },
    });
    await expect(restoreCanvasTargetText(input)).rejects.toMatchObject({
      code: "TARGET_HTTP",
      status: 409,
    });
    expect(calls).toBe(2);
    expect(f.reads).toEqual([1, 2]);
    expect(f.attempts.map(version)).toEqual([1, 2]);
    expect(f.accepted).toHaveLength(0);
    expect((await f.current()).objects.find(({ id }) => id === f.original.id)).toMatchObject({
      text: `${canvasTargetMarker} third-party successor`,
      version: 3,
    });
  });

  it.each(["deadline", "budget"])(
    "rechecks the%s after the bounded second read before any retry",
    async (kind) => {
      const f = await fixture();
      let reads = 0;
      const input = f.input({
        read: async () => {
          const current = await f.read();
          if (++reads === 2 && kind === "deadline") input.deadline = performance.now() - 1;
          return current;
        },
        write: async (mutation) => {
          await f.edit(f.input().attempted.text, 1);
          if (kind === "budget") {
            // Seed only the sequence-bound edge, not thousands of operations or a raised receipt cap.
            // Both reads and every version check still use the actual repository.
            const store = f.repository.getOrCreateLifecycleExtension(
              "canvasBoards",
              () => new MemoryCanvasBoards(f.repository),
            );
            store.rows.get(f.board.id)!.board.canvasSeq = 4500;
          }
          return f.write(mutation);
        },
      });
      await expect(restoreCanvasTargetText(input)).resolves.toBe(
        kind === "deadline" ? "skipped-cleanup-deadline" : "skipped-budget",
      );
      expect(reads).toBe(2);
      expect(f.attempts).toHaveLength(1);
      expect(f.accepted).toHaveLength(0);
      expect((await f.current()).objects.find(({ id }) => id === f.original.id)).toMatchObject({
        text: input.attempted.text,
        version: 2,
      });
    },
  );

  it.each([false, true])(
    "accepts an exact fence receipt with a later fresh-board projection (own proposal initially present=%s)",
    async (proposalPresent) => {
      const f = await fixture(),
        proposal = f.input().attempted;
      if (proposalPresent) await f.edit(proposal.text, 1);
      let receiptSequence = 0,
        projectedSequence = 0;
      const result = await restoreCanvasTargetText(
        f.input({
          write: async (mutation) => {
            const response = await f.write(mutation);
            receiptSequence = response.receipt.canvasSeq;
            await f.edit(
              `${canvasTargetMarker} unrelated concurrent edit`,
              1,
              f.editor,
              f.unrelated.id,
            );
            const fresh = await f.current();
            projectedSequence = fresh.canvasSeq;
            return { ...response, board: fresh };
          },
        }),
      );
      expect(result).toBe(proposalPresent ? "restored" : "fenced-unchanged");
      expect(projectedSequence).toBe(receiptSequence + 1);
      expect(f.accepted).toHaveLength(1);
      expect(f.attempts).toHaveLength(1);
      const current = await f.current();
      expect(current.objects.find(({ id }) => id === f.original.id)?.text).toBe(f.original.text);
      expect(current.objects.find(({ id }) => id === f.unrelated.id)).toMatchObject({
        text: `${canvasTargetMarker} unrelated concurrent edit`,
        version: 2,
      });
    },
  );
});

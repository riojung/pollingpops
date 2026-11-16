import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PresentationDraft } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";
import {
  closeE01Overlays,
  createE01Deck,
  e01ApiUrl,
  e01Body,
  e01Slide,
  enterE01Editor,
  readE01Record,
  selectE01Body,
  type E01Record,
} from "./presentation-e01-support";

type DraftEnvelope = {
  draft: PresentationDraft;
  expectedRevision: number;
  mutationId: string;
  schemaVersion: 2;
};
type SaveAttempt = {
  raw: string;
  envelope: DraftEnvelope;
  status?: number;
  acceptedRevision?: number;
};
type CleanupGateWindow = typeof window & {
  e01PendingCleanup: {
    entered: boolean;
    release: () => void;
    restore: () => void;
  };
};

test.use({ actionTimeout: 30_000 });
test.beforeEach(async ({ page }) => {
  acceptBeforeUnload(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

function acceptBeforeUnload(page: Page) {
  page.on("dialog", async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.accept();
  });
}

async function openRecoveryDeck(page: Page, narrow = false) {
  await signInBeta(page);
  const hidden = { ...e01Slide("Private recovered context"), hidden: true as const };
  const record = await createE01Deck(page, [e01Slide("Recovery work", true), hidden], 6);
  await enterE01Editor(page, record.id, narrow);
  await selectE01Body(page);
  return record;
}

async function reloadRecoveryEditor(page: Page, narrow = false) {
  await page.reload();
  if (narrow) {
    await closeE01Overlays(page);
  }
  await selectE01Body(page);
}

async function interceptDraftSaves(page: Page, id: string, initial: "lose" | "abort" = "lose") {
  const url = `${e01ApiUrl}/v1/presentations/${id}/draft`;
  const attempts: SaveAttempt[] = [];
  let behavior: "lose" | "abort" | "pass" = initial;
  await page.route(url, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const mode = behavior;
    const raw = route.request().postData()!;
    const attempt: SaveAttempt = { raw, envelope: JSON.parse(raw) as DraftEnvelope };
    attempts.push(attempt);
    if (mode === "abort") return route.abort("failed");
    // The real API persists each request. Only its acknowledgement is discarded.
    const response = await route.fetch();
    attempt.status = response.status();
    if (response.ok()) {
      attempt.acceptedRevision = ((await response.json()).presentation as E01Record).draftRevision;
    }
    if (mode === "lose") {
      expect(response.status(), await response.text()).toBe(200);
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  return {
    attempts,
    allowAcknowledgements: () => {
      behavior = "pass";
    },
    dispose: () => page.unroute(url),
  };
}

async function delayPendingSaveCleanup(page: Page, id: string) {
  await page.evaluate((key) => {
    const nativeDelete = IDBObjectStore.prototype.delete;
    let armed = true;
    let released = false;
    let complete: (() => void) | undefined;
    const gate = {
      entered: false,
      release: () => {
        released = true;
        complete?.();
      },
      restore: () => {
        IDBObjectStore.prototype.delete = nativeDelete;
        gate.release();
      },
    };
    (window as CleanupGateWindow).e01PendingCleanup = gate;
    IDBObjectStore.prototype.delete = function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ) {
      const request = nativeDelete.call(this, query);
      if (
        !armed ||
        query !== key ||
        this.name !== "drafts" ||
        this.transaction.db.name !== "openround-builder-recovery"
      )
        return request;
      armed = false;
      let onSuccess: typeof request.onsuccess = null;
      // Complete the real deletion normally, but hold its caller's success callback once.
      Object.defineProperty(request, "onsuccess", {
        configurable: true,
        get: () => onSuccess,
        set: (handler: typeof request.onsuccess) => {
          onSuccess = handler;
        },
      });
      request.addEventListener("success", (event) => {
        complete = () => {
          complete = undefined;
          onSuccess?.call(request, event);
        };
        gate.entered = true;
        if (released) complete();
      });
      return request;
    };
  }, `presentation:${id}:pending-save`);
  return {
    entered: () => page.evaluate(() => (window as CleanupGateWindow).e01PendingCleanup.entered),
    release: () => page.evaluate(() => (window as CleanupGateWindow).e01PendingCleanup.release()),
    restore: () => page.evaluate(() => (window as CleanupGateWindow).e01PendingCleanup.restore()),
  };
}

function savedStatus(page: Page) {
  return page.getByRole("status").filter({ hasText: /^Saved$/ });
}

function expectRetainedSource(draft: PresentationDraft, initial: PresentationDraft, body: string) {
  expect(draft.schemaVersion).toBe(6);
  expect(draft.blocks.map((block) => block.id)).toEqual(initial.blocks.map((block) => block.id));
  expect(draft.blocks[1]).toEqual(initial.blocks[1]);
  expect(e01Body(draft)).toBe(body);
  const block = draft.blocks[0];
  if (block?.kind !== "content") throw new Error("Expected the visible native slide");
  const node = block.scene?.nodes.find((node) => node.type === "text" && node.role === "body");
  expect(block.scene?.schemaVersion).toBe(2);
  if (node?.type !== "text" || !node.richText) throw new Error("Expected canonical rich text");
  expect(
    node.richText.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
      .join("\n"),
  ).toBe(body);
}

function changeRemoteBody(draft: PresentationDraft, text: string): PresentationDraft {
  return {
    ...draft,
    blocks: draft.blocks.map((block, index) =>
      index === 0 && block.kind === "content" && block.scene
        ? {
            ...block,
            scene: {
              ...block.scene,
              nodes: block.scene.nodes.map((node) =>
                node.type === "text" && node.role === "body"
                  ? {
                      ...node,
                      text,
                      richText: { paragraphs: [{ kind: "bullet" as const, runs: [{ text }] }] },
                    }
                  : node,
              ),
            },
          }
        : block,
    ),
  };
}

async function saveRemoteBody(page: Page, record: E01Record, body: string) {
  // APIRequestContext bypasses page.route, representing another editor's real save.
  const response = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
    data: {
      draft: changeRemoteBody(record.draft, body),
      expectedRevision: record.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).presentation as E01Record;
}

async function downloadRecovery(page: Page, button: Locator): Promise<PresentationDraft> {
  const downloading = page.waitForEvent("download");
  await button.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/-local-copy\.json$/);
  const file = await download.path();
  if (!file) throw new Error("Expected a downloaded recovery file");
  return JSON.parse(await readFile(file, "utf8")) as PresentationDraft;
}

async function previewRecovery(page: Page, body: string) {
  await page.getByRole("button", { name: "Preview local copy", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
  await expect(preview.getByText(body, { exact: true })).toBeVisible();
  await expect(preview.getByText("Private recovered context", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
}

test("E01 Undo during receipt cleanup autosaves the restored rich draft at the next revision", async ({
  page,
}) => {
  const initial = await openRecoveryDeck(page);
  const cleanup = await delayPendingSaveCleanup(page, initial.id);
  const saveUrl = `${e01ApiUrl}/v1/presentations/${initial.id}/draft`;
  const requests: DraftEnvelope[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url() === saveUrl)
      requests.push(request.postDataJSON() as DraftEnvelope);
  });
  const edited = "Accepted work before Undo during local receipt cleanup";
  const original = e01Body(initial.draft);
  try {
    await page.getByLabel("Node text", { exact: true }).fill(edited);
    await expect.poll(cleanup.entered).toBe(true);
    const accepted = await readE01Record(page, initial.id);
    expect(accepted.draftRevision).toBe(initial.draftRevision + 1);
    expectRetainedSource(accepted.draft, initial.draft, edited);
    expect(requests).toHaveLength(1);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByLabel("Node text", { exact: true })).toHaveValue(original);
    // Give React's passive autosave effect a rendering turn while cleanup is still held.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await cleanup.release();

    // No further edit or manual save should be needed to persist Undo through the draft API.
    await expect
      .poll(async () => {
        const saved = await readE01Record(page, initial.id);
        return { revision: saved.draftRevision, body: e01Body(saved.draft) };
      })
      .toEqual({ revision: initial.draftRevision + 2, body: original });
    await expect(savedStatus(page)).toBeVisible();
    const saved = await readE01Record(page, initial.id);
    expectRetainedSource(saved.draft, initial.draft, original);
    expect(saved.draft).toEqual(initial.draft);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      expectedRevision: initial.draftRevision,
      schemaVersion: 2,
    });
    expect(requests[1]).toMatchObject({
      draft: initial.draft,
      expectedRevision: initial.draftRevision + 1,
      schemaVersion: 2,
    });
    expect(requests[1]!.mutationId).not.toBe(requests[0]!.mutationId);
  } finally {
    await cleanup.restore();
  }
});

test("E01 retry settles the exact lost receipt before saving newer rich text", async ({ page }) => {
  const initial = await openRecoveryDeck(page);
  const network = await interceptDraftSaves(page, initial.id);
  const accepted = "Accepted original work";
  const latest = "Latest local work while acknowledgement is unresolved";
  try {
    await page.getByLabel("Node text", { exact: true }).fill(accepted);
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
    expect(network.attempts.length).toBeGreaterThanOrEqual(3);
    const first = network.attempts[0]!;
    expect(new Set(network.attempts.map((attempt) => attempt.raw)).size).toBe(1);
    expect(first.envelope).toMatchObject({
      expectedRevision: initial.draftRevision,
      schemaVersion: 2,
    });
    const committed = await readE01Record(page, initial.id);
    expect(committed.draftRevision).toBe(initial.draftRevision + 1);
    expectRetainedSource(committed.draft, initial.draft, accepted);

    // The receipt is still unresolved when newer text replaces the local working copy.
    await page.getByLabel("Node text", { exact: true }).fill(latest);
    network.allowAcknowledgements();
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(savedStatus(page)).toBeVisible();
    const saved = await readE01Record(page, initial.id);
    expect(saved.draftRevision).toBe(initial.draftRevision + 2);
    expectRetainedSource(saved.draft, initial.draft, latest);
    await expect(page.getByLabel("Node text", { exact: true })).toHaveValue(latest);

    const newestIndex = network.attempts.findIndex(
      (attempt) => attempt.envelope.mutationId !== first.envelope.mutationId,
    );
    expect(newestIndex).toBeGreaterThanOrEqual(4);
    expect(
      network.attempts.slice(0, newestIndex).every((attempt) => attempt.raw === first.raw),
    ).toBe(true);
    const newest = network.attempts[newestIndex]!;
    expect(newest.envelope.expectedRevision).toBe(initial.draftRevision + 1);
    expectRetainedSource(newest.envelope.draft, initial.draft, latest);
    expect(network.attempts.slice(newestIndex).every((attempt) => attempt.raw === newest.raw)).toBe(
      true,
    );
  } finally {
    await network.dispose();
  }
});

for (const suffix of ["", " @mobile"]) {
  test(`E01 refresh replays the persisted accepted receipt and continues at the new revision${suffix}`, async ({
    page,
  }, testInfo) => {
    const narrow = (testInfo.project.use.viewport?.width ?? 1280) <= 700;
    const initial = await openRecoveryDeck(page, narrow);
    const network = await interceptDraftSaves(page, initial.id);
    const recovered = "Recovered accepted rich text after refresh";
    const continued = "Continued editing after the receipt was recovered";
    try {
      await page.getByLabel("Node text", { exact: true }).fill(recovered);
      await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
      const first = network.attempts[0]!;
      const beforeRefresh = network.attempts.length;
      expect(beforeRefresh).toBeGreaterThanOrEqual(3);
      expect((await readE01Record(page, initial.id)).draftRevision).toBe(initial.draftRevision + 1);
      network.allowAcknowledgements();
      await reloadRecoveryEditor(page, narrow);
      await expect(page.getByLabel("Node text", { exact: true })).toHaveValue(recovered);
      await expect(savedStatus(page)).toBeVisible();
      expect(network.attempts.length).toBeGreaterThan(beforeRefresh);
      expect(network.attempts.every((attempt) => attempt.raw === first.raw)).toBe(true);
      expect((await readE01Record(page, initial.id)).draftRevision).toBe(initial.draftRevision + 1);

      await page.getByLabel("Node text", { exact: true }).fill(continued);
      await expect(savedStatus(page)).toBeVisible();
      const saved = await readE01Record(page, initial.id);
      expect(saved.draftRevision).toBe(initial.draftRevision + 2);
      expectRetainedSource(saved.draft, initial.draft, continued);
      const newest = network.attempts.find(
        (attempt) => attempt.envelope.mutationId !== first.envelope.mutationId,
      )!;
      expect(newest.envelope.expectedRevision).toBe(initial.draftRevision + 1);
    } finally {
      await network.dispose();
    }
  });
}

test("E01 failed transport and refresh preserve a divergent local copy for preview, download and duplication", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const initial = await openRecoveryDeck(page);
  const network = await interceptDraftSaves(page, initial.id, "abort");
  const local = "Local rich text never sent to the server";
  const remote = "Remote independently saved work";
  try {
    await page.getByLabel("Node text", { exact: true }).fill(local);
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
    expect(network.attempts.length).toBeGreaterThanOrEqual(3);
    expect((await readE01Record(page, initial.id)).draftRevision).toBe(initial.draftRevision);
    await reloadRecoveryEditor(page);
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
    await expect(page.getByLabel("Node text", { exact: true })).toHaveValue(local);
    await expect(
      page
        .getByRole("status", { name: "Local draft recovery", exact: true })
        .getByRole("button", { name: "Restore local copy", exact: true }),
    ).toBeVisible();
    expect((await readE01Record(page, initial.id)).draftRevision).toBe(initial.draftRevision);
    await saveRemoteBody(page, initial, remote);
    network.allowAcknowledgements();
    await reloadRecoveryEditor(page);
    await expect(page.getByRole("button", { name: "Reload current", exact: true })).toBeVisible();
    await expect(page.getByLabel("Node text", { exact: true })).toHaveValue(local);
    const recovery = page.getByRole("status", { name: "Local draft recovery", exact: true });
    await expect(recovery).toContainText(`based on revision ${initial.draftRevision}`);
    await expect(
      recovery.getByRole("button", { name: "Restore local copy", exact: true }),
    ).toHaveCount(0);
    expect(network.attempts.some((attempt) => attempt.status === 409)).toBe(true);
    const saved = await readE01Record(page, initial.id);
    expect(saved.draftRevision).toBe(initial.draftRevision + 1);
    expectRetainedSource(saved.draft, initial.draft, remote);
    await previewRecovery(page, local);
    const downloaded = await downloadRecovery(
      page,
      recovery.getByRole("button", { name: "Download local copy", exact: true }),
    );
    expectRetainedSource(downloaded, initial.draft, local);

    await recovery.getByRole("button", { name: "Duplicate local copy", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/presentation/(?!${initial.id}$)[^/]+$`));
    const copyId = new URL(page.url()).pathname.split("/").at(-1)!;
    const copy = await readE01Record(page, copyId);
    expectRetainedSource(copy.draft, initial.draft, local);
    expectRetainedSource((await readE01Record(page, initial.id)).draft, initial.draft, remote);
  } finally {
    await network.dispose();
  }
});

test("E01 an older accepted receipt cannot overwrite a newer remote revision after refresh", async ({
  page,
}) => {
  const initial = await openRecoveryDeck(page);
  const network = await interceptDraftSaves(page, initial.id);
  const local = "Accepted local copy with a lost receipt";
  const remote = "Newer remote copy after the accepted local save";
  try {
    await page.getByLabel("Node text", { exact: true }).fill(local);
    await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
    const first = network.attempts[0]!;
    const accepted = await readE01Record(page, initial.id);
    expect(accepted.draftRevision).toBe(initial.draftRevision + 1);
    await saveRemoteBody(page, accepted, remote);
    const beforeRefresh = network.attempts.length;
    network.allowAcknowledgements();
    await reloadRecoveryEditor(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "another saved revision is newer" }),
    ).toBeVisible();
    await expect(page.getByLabel("Node text", { exact: true })).toHaveValue(local);
    await expect(page.getByRole("button", { name: "Restore local copy", exact: true })).toHaveCount(
      0,
    );
    const replays = network.attempts.slice(beforeRefresh);
    expect(replays.length).toBeGreaterThan(0);
    expect(replays.every((attempt) => attempt.raw === first.raw)).toBe(true);
    expect(replays.every((attempt) => attempt.acceptedRevision === initial.draftRevision + 1)).toBe(
      true,
    );
    const saved = await readE01Record(page, initial.id);
    expect(saved.draftRevision).toBe(initial.draftRevision + 2);
    expectRetainedSource(saved.draft, initial.draft, remote);
    await previewRecovery(page, local);
  } finally {
    await network.dispose();
  }
});

test("E01 two editors preserve stale local text until Reload current is explicitly chosen", async ({
  page,
  context,
}) => {
  const initial = await openRecoveryDeck(page);
  const other = await context.newPage();
  acceptBeforeUnload(other);
  const remote = "Other editor saved first";
  const local = "Stale editor local work to preserve";
  const resolved = "Continued from the explicitly reloaded revision";
  try {
    await enterE01Editor(other, initial.id, false);
    await selectE01Body(other);
    await page.getByLabel("Node text", { exact: true }).fill(remote);
    await expect(savedStatus(page)).toBeVisible();
    const staleSave = other.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url() === `${e01ApiUrl}/v1/presentations/${initial.id}/draft`,
    );
    await other.getByLabel("Node text", { exact: true }).fill(local);
    expect((await staleSave).status()).toBe(409);
    await expect(other.getByRole("button", { name: "Reload current", exact: true })).toBeVisible();
    await expect(other.getByLabel("Node text", { exact: true })).toHaveValue(local);
    expectRetainedSource((await readE01Record(page, initial.id)).draft, initial.draft, remote);
    await other.getByRole("button", { name: "Reload current", exact: true }).click();
    await selectE01Body(other);
    await expect(other.getByLabel("Node text", { exact: true })).toHaveValue(remote);
    const recovery = other.getByRole("status", { name: "Local draft recovery", exact: true });
    await expect(recovery).toContainText(`based on revision ${initial.draftRevision}`);
    await expect(
      recovery.getByRole("button", { name: "Restore local copy", exact: true }),
    ).toHaveCount(0);
    await previewRecovery(other, local);
    const downloaded = await downloadRecovery(
      other,
      recovery.getByRole("button", { name: "Download local copy", exact: true }),
    );
    expectRetainedSource(downloaded, initial.draft, local);
    await other.getByLabel("Node text", { exact: true }).fill(resolved);
    await expect(savedStatus(other)).toBeVisible();
    const saved = await readE01Record(page, initial.id);
    expect(saved.draftRevision).toBe(initial.draftRevision + 2);
    expectRetainedSource(saved.draft, initial.draft, resolved);
  } finally {
    await other.close({ runBeforeUnload: true });
  }
});

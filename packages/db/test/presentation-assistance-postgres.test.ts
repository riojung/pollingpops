import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresRepository,
  assertRestrictedRuntimeDatabasePrincipal,
  createPresentationAssistanceRepository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectPresentationAssistanceConformance,
  expectPresentationAssistanceQuota,
  expectPresentationAssistanceErasure,
  presentationAssistanceFixture,
  assistanceProposal,
  assistanceFence,
  assistanceIdentity,
} from "./support/presentation-assistance-conformance.js";
import { lockPresentationAssistanceActors } from "../src/presentation-assistance-identity.js";
import { summaryMember } from "./support/session-summary-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation outline assistance PostgreSQL", () => {
  const database = `presentation_assistance_${randomUUID().replaceAll("-", "")}`;
  let created = false,
    repository: PostgresRepository,
    administrator: PostgresRepository,
    runtimeDatabaseUrl: string;
  beforeAll(async () => {
    await preparePostgresTestRuntime(adminUrl!, runtimeUrl!);
    const cluster = new PostgresRepository(adminUrl!);
    try {
      await cluster.pool.query(`CREATE DATABASE "${database}"`);
      created = true;
    } finally {
      await cluster.close();
    }
    const admin = new URL(adminUrl!),
      runtime = new URL(runtimeUrl!);
    admin.pathname = runtime.pathname = `/${database}`;
    runtimeDatabaseUrl = runtime.toString();
    administrator = new PostgresRepository(admin.toString());
    await administrator.migrate();
    await administrator.migrate();
    expect(
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=100"))
        .rows,
    ).toEqual([{ name: "presentation_assistance" }]);
    repository = new PostgresRepository(runtimeDatabaseUrl);
    await repository.initialize();
    expect(
      assertRestrictedRuntimeDatabasePrincipal(await repository.inspectRuntimeDatabasePrincipal()),
    ).toMatchObject({
      superuser: false,
      bypassRls: false,
      createRole: false,
      createDatabase: false,
    });
    expect(
      (
        await administrator.pool.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname",
          [["authoring_admission_receipts", "presentation_assistance_jobs"]],
        )
      ).rows,
    ).toEqual(
      ["authoring_admission_receipts", "presentation_assistance_jobs"].map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      })),
    );
  }, 60_000);
  afterAll(async () => {
    await repository?.close();
    await administrator?.close();
    if (created) {
      const cluster = new PostgresRepository(adminUrl!);
      try {
        await cluster.pool.query(`DROP DATABASE "${database}" WITH(FORCE)`);
      } finally {
        await cluster.close();
      }
    }
  });
  it("persists complete normalized proposals, protects legacy DTOs and erases private data at expiry", async () => {
    const f = await expectPresentationAssistanceConformance(repository);
    const rows = (
      await administrator.pool.query(
        "SELECT status,outline,proposal,proposal_hash,source_name,created_by FROM presentation_assistance_jobs WHERE workspace_id=$1 ORDER BY created_at,id",
        [f.actor.workspaceId],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row).toEqual({
        status: "expired",
        outline: null,
        proposal: null,
        proposal_hash: null,
        source_name: "Erased outline",
        created_by: null,
      });
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS used FROM authoring_admission_receipts WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows[0].used,
    ).toBe(3);
  });
  it("serializes the final allowance across both admission paths and distinguishes cross-stream UUIDs", async () => {
    await expectPresentationAssistanceQuota(repository);
  });
  it("retains compact admissions after actor erasure, deck deletion and expired private-source cleanup", async () => {
    const f = await expectPresentationAssistanceErasure(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_assistance_jobs WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await administrator.pool.query(
          "SELECT count(*)::integer AS count FROM authoring_admission_receipts WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("reopens ready proposals with JSONB key order and clears raw sources on success or terminal failure", async () => {
    const f = await presentationAssistanceFixture(repository),
      created = await f.jobs.create(f.create()),
      claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!;
    expect(claim.id).toBe(created.job.id);
    const proposal = assistanceProposal(claim);
    expect(await f.jobs.complete({ ...assistanceFence(claim, f.now), proposal })).toBe(true);
    const reopened = new PostgresRepository(runtimeDatabaseUrl);
    try {
      expect(
        (
          await createPresentationAssistanceRepository(reopened).get({
            ...f.context,
            jobId: created.job.id,
          })
        )?.proposal,
      ).toEqual(proposal);
    } finally {
      await reopened.close();
    }
    expect(
      (
        await administrator.pool.query(
          "SELECT outline FROM presentation_assistance_jobs WHERE id=$1",
          [created.job.id],
        )
      ).rows[0].outline,
    ).toBeNull();
    const failure = await f.jobs.create(f.create()),
      next = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!;
    expect(next.id).toBe(failure.job.id);
    expect(
      await f.jobs.fail({
        ...assistanceFence(next, f.now),
        terminal: true,
        errorCode: "PROVIDER_UNAVAILABLE",
      }),
    ).toBe(true);
    expect(
      (
        await administrator.pool.query(
          "SELECT outline,proposal,status FROM presentation_assistance_jobs WHERE id=$1",
          [failure.job.id],
        )
      ).rows[0],
    ).toEqual({ outline: null, proposal: null, status: "failed" });
  });
  it("rechecks revoked creators and forces tenant RLS plus source, output and attempt invariants", async () => {
    const f = await presentationAssistanceFixture(repository),
      member = await assistanceIdentity(repository);
    await summaryMember(repository, f.actor, member, "editor");
    const input = { ...f.create(), actorId: member.userId },
      created = await f.jobs.create(input),
      claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!;
    expect(claim.id).toBe(created.job.id);
    expect(
      (
        await repository.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_assistance_jobs",
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await repository.pool.query(
          "SELECT count(*)::integer AS count FROM authoring_admission_receipts",
        )
      ).rows[0].count,
    ).toBe(0);
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [randomUUID()]);
      expect(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM presentation_assistance_jobs WHERE id=$1",
            [created.job.id],
          )
        ).rows[0].count,
      ).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    for (const sql of [
      "UPDATE presentation_assistance_jobs SET request_hash=repeat('b',64) WHERE id=$1",
      "UPDATE presentation_assistance_jobs SET outline=repeat('changed',20) WHERE id=$1",
      "UPDATE presentation_assistance_jobs SET attempts=0 WHERE id=$1",
      "UPDATE presentation_assistance_jobs SET status='ready',outline=NULL,lease_token=NULL,lease_until=NULL,proposal='{}',proposal_hash=repeat('c',64) WHERE id=$1",
    ])
      await expect(administrator.pool.query(sql, [created.job.id])).rejects.toMatchObject({
        code: "23514",
      });
    await repository.updateWorkspaceMemberRole(f.actor.workspaceId, member.userId, "viewer");
    expect(
      await f.jobs.complete({
        ...assistanceFence(claim, f.now),
        proposal: assistanceProposal(claim),
      }),
    ).toBe(false);
    await expect(f.jobs.create({ ...input, request: f.request() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (
        await administrator.pool.query(
          "SELECT created_by,outline,proposal,source_name,status FROM presentation_assistance_jobs WHERE id=$1",
          [created.job.id],
        )
      ).rows[0],
    ).toEqual({
      created_by: null,
      outline: null,
      proposal: null,
      source_name: "Erased outline",
      status: "failed",
    });
  });
  it("keeps identity reads scoped while admitting and atomically applying a reviewed draft under the restricted runtime", async () => {
    const f = await presentationAssistanceFixture(repository),
      created = await f.jobs.create(f.create()),
      claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!;
    expect(
      await f.jobs.complete({
        ...assistanceFence(claim, f.now),
        proposal: assistanceProposal(claim),
      }),
    ).toBe(true);
    const ready = (await f.jobs.get({ ...f.context, jobId: created.job.id }))!;
    const draft = { ...f.presentation.draft, title: "Reviewed outline insertion" },
      input = {
        workspaceId: f.actor.workspaceId,
        presentationId: f.presentation.id,
        draft,
        expectedRevision: 0,
        mutationId: randomUUID(),
        editorId: f.actor.userId,
        draftHash: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
        assistanceJobId: ready.id,
        assistanceProposalHash: ready.proposalHash!,
      };
    const inserted = await f.presentations.updatePresentationDraft(input);
    expect(inserted?.draftRevision).toBe(1);
    expect(inserted?.draft.title).toBe(draft.title);
    await f.jobs.purgeExpired(new Date(ready.expiresAt));
    expect(await f.presentations.updatePresentationDraft(input)).toEqual(inserted);
    await expect(
      f.presentations.updatePresentationDraft({
        ...input,
        expectedRevision: 1,
        mutationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.presentations.getPresentation(f.actor.workspaceId, f.presentation.id))
        ?.draftRevision,
    ).toBe(1);
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM users")).rows[0].count,
      ).toBe(0);
      expect((await lockPresentationAssistanceActors(client, [f.actor.userId])).rows).toEqual([
        { id: f.actor.userId },
      ]);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM users")).rows[0].count,
      ).toBe(0);
      await expect(
        lockPresentationAssistanceActors(client, ["invalid-uuid"]),
      ).rejects.toMatchObject({ code: "22P02" });
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM users")).rows[0].count,
      ).toBe(0);
      expect(
        (
          await client.query("SELECT presentation_assistance_author_active($1,$2) AS active", [
            f.actor.workspaceId,
            f.actor.userId,
          ])
        ).rows[0].active,
      ).toBe(true);
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [randomUUID()]);
      expect(
        (
          await client.query("SELECT presentation_assistance_author_active($1,$2) AS active", [
            f.actor.workspaceId,
            f.actor.userId,
          ])
        ).rows[0].active,
      ).toBe(false);
      expect(
        (await client.query("SELECT count(*)::integer AS count FROM users")).rows[0].count,
      ).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
  it("uses the generic retention hook even without a model worker and preserves quota receipts", async () => {
    const f = await presentationAssistanceFixture(repository),
      created = await f.jobs.create({ ...f.create(), expiresAt: new Date(f.now.getTime() + 1000) });
    await repository.purgeExpired(new Date(f.now.getTime() + 1000));
    expect(
      (
        await administrator.pool.query(
          "SELECT status,outline,proposal,source_name FROM presentation_assistance_jobs WHERE id=$1",
          [created.job.id],
        )
      ).rows[0],
    ).toEqual({ status: "expired", outline: null, proposal: null, source_name: "Erased outline" });
    expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
  });
});

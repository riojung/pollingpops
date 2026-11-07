import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  presentationQuestionSuggestionsSourceFingerprint,
  presentationQuestionSuggestionsSourceDigest,
  presentationQuestionSuggestionsRequestHash,
} from "@openround/contracts";
import { PostgresRepository, assertRestrictedRuntimeDatabasePrincipal } from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectQuestionSuggestionsConformance,
  expectQuestionSuggestionsCapacity,
  expectQuestionSuggestionsSourceFence,
  expectQuestionSuggestionsInsertionFence,
  expectQuestionSuggestionsLifecycle,
  expectQuestionSuggestionsRevocation,
  questionSuggestionsFixture,
  questionProposal,
  questionFence,
} from "./support/presentation-question-suggestions-conformance.js";
import {
  assistanceProposal,
  assistanceFence,
} from "./support/presentation-assistance-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation question suggestions PostgreSQL", () => {
  const database = `presentation_question_suggestions_${randomUUID().replaceAll("-", "")}`;
  let created = false,
    repository: PostgresRepository,
    administrator: PostgresRepository;
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
    administrator = new PostgresRepository(admin.toString());
    await administrator.migrate();
    await administrator.migrate();
    repository = new PostgresRepository(runtime.toString());
    await repository.initialize();
    expect(
      assertRestrictedRuntimeDatabasePrincipal(await repository.inspectRuntimeDatabasePrincipal()),
    ).toMatchObject({ superuser: false, bypassRls: false });
    expect(
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=104"))
        .rows,
    ).toEqual([{ name: "presentation_question_suggestions" }]);
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='presentation_question_suggestions_jobs'",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  }, 60000);
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
  it("preserves exact canonical source/proposal bytes, normal insertion and accepted receipts after expiry", async () => {
    const f = await expectQuestionSuggestionsConformance(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT status,source_snapshot,proposal,proposal_hash,created_by FROM presentation_question_suggestions_jobs WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([
      {
        status: "expired",
        source_snapshot: null,
        proposal: null,
        proposal_hash: null,
        created_by: null,
      },
    ]);
  });
  it("shares monthly allowance and combined presentation capacity across all three queues", async () => {
    await expectQuestionSuggestionsCapacity(repository);
  });
  it("rechecks full source language, rich paragraph kinds and reading order under the insertion lock", async () => {
    await expectQuestionSuggestionsSourceFence(repository);
  });
  it("rejects substituted question/block content and expired new insertions", async () => {
    await expectQuestionSuggestionsInsertionFence(repository);
  });
  it("fences reclaimed leases and the three-attempt ceiling", async () => {
    await expectQuestionSuggestionsLifecycle(repository);
  });
  it("scrubs private sources/proposals on author removal, downgrade and deletion without losing accepted receipts", async () => {
    for (const row of await expectQuestionSuggestionsRevocation(repository))
      expect(
        (
          await administrator.pool.query(
            "SELECT source_snapshot,proposal,proposal_hash,created_by,error_code FROM presentation_question_suggestions_jobs WHERE id=$1",
            [row.jobId],
          )
        ).rows,
      ).toEqual([
        {
          source_snapshot: null,
          proposal: null,
          proposal_hash: null,
          created_by: null,
          error_code: "SOURCE_UNAVAILABLE",
        },
      ]);
  });
  async function rawReject(sql: string, values: unknown[], workspaceId: string) {
    const client = await administrator.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
      await expect(client.query(sql, values)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  it("enforces the same two-active cap in all three raw SQL admission guards", async () => {
    const f = await questionSuggestionsFixture(repository);
    const outline = await f.outlineJobs.create(f.outlineCreate());
    await f.textJobs.create(f.textCreate());
    const input = f.create(),
      values = [
        input.request.requestId,
        f.actor.workspaceId,
        f.presentation.id,
        f.actor.userId,
        presentationQuestionSuggestionsRequestHash(input.request),
        input.request.sourceDigest,
        f.blockId,
        JSON.stringify(f.source),
        f.now,
        new Date(f.now.getTime() + 86_400_000),
      ];
    await rawReject(
      `INSERT INTO presentation_question_suggestions_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,source_revision,output_language,source_snapshot,status,attempts,available_at,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'en',$8,'pending',0,$9,$9,$9,$10)`,
      values,
      f.actor.workspaceId,
    );
    const claim = (await f.outlineJobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!;
    expect(claim.id).toBe(outline.job.id);
    await f.outlineJobs.complete({
      ...assistanceFence(claim, f.now),
      proposal: assistanceProposal(claim),
    });
    await f.jobs.create(input);
    const statements = [
      `INSERT INTO presentation_assistance_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,source_name,slide_count,outline,status,attempts,available_at,created_at,updated_at,expires_at) SELECT $1,workspace_id,presentation_id,created_by,request_hash,source_digest,source_name,slide_count,'A sufficiently long copied source outline for raw admission capacity checks.','pending',0,available_at,created_at,updated_at,expires_at FROM presentation_assistance_jobs WHERE workspace_id=$2 LIMIT 1`,
      `INSERT INTO presentation_text_assistance_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,node_id,operation,role,source_revision,original_text,status,attempts,available_at,created_at,updated_at,expires_at) SELECT $1,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,node_id,operation,role,source_revision,original_text,'pending',0,available_at,created_at,updated_at,expires_at FROM presentation_text_assistance_jobs WHERE workspace_id=$2 LIMIT 1`,
    ];
    for (const statement of statements) {
      await rawReject(statement, [randomUUID(), f.actor.workspaceId], f.actor.workspaceId);
      // Caller-controlled future timestamps cannot make the two real active jobs disappear.
      const future = statement.replaceAll(
        "0,available_at,created_at,updated_at,expires_at",
        "0,statement_timestamp()+interval '48 hours',statement_timestamp()+interval '48 hours',statement_timestamp()+interval '48 hours',statement_timestamp()+interval '72 hours'",
      );
      await rawReject(future, [randomUUID(), f.actor.workspaceId], f.actor.workspaceId);
    }
    const futureRequest = { ...input.request, requestId: randomUUID() };
    const futureValues = [...values];
    futureValues[0] = futureRequest.requestId;
    futureValues[4] = presentationQuestionSuggestionsRequestHash(futureRequest);
    futureValues[8] = new Date(f.now.getTime() + 48 * 60 * 60_000);
    futureValues[9] = new Date(f.now.getTime() + 72 * 60 * 60_000);
    await rawReject(
      `INSERT INTO presentation_question_suggestions_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,source_revision,output_language,source_snapshot,status,attempts,available_at,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'en',$8,'pending',0,$9,$9,$9,$10)`,
      futureValues,
      f.actor.workspaceId,
    );
    expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(3);
    await repository.deleteAccount(f.actor.userId);
  });
  it("binds raw admission to the exact saved source and rejects mutable identity and invented ready citations", async () => {
    const f = await questionSuggestionsFixture(repository),
      input = f.create();
    await f.jobs.create(input);
    const stored = (
      await administrator.pool.query(
        "SELECT source_snapshot,openround_question_suggestions_source_json(source_snapshot) canonical FROM presentation_question_suggestions_jobs WHERE id=$1",
        [input.request.requestId],
      )
    ).rows[0]!;
    expect(stored.canonical).toBe(presentationQuestionSuggestionsSourceFingerprint(f.source));
    await rawReject(
      "UPDATE presentation_question_suggestions_jobs SET source_digest=$2 WHERE id=$1",
      [input.request.requestId, "f".repeat(64)],
      f.actor.workspaceId,
    );
    const changed = structuredClone(f.source);
    changed.title.text = "Caller substituted title";
    const second = f.create();
    second.source = changed;
    await expect(f.jobs.create(second)).rejects.toMatchObject({ code: "CONFLICT" });
    const spoofRequest = {
      ...input.request,
      requestId: randomUUID(),
      sourceDigest: presentationQuestionSuggestionsSourceDigest(changed),
    };
    const spoofValues = [
      spoofRequest.requestId,
      f.actor.workspaceId,
      f.presentation.id,
      f.actor.userId,
      presentationQuestionSuggestionsRequestHash(spoofRequest),
      spoofRequest.sourceDigest,
      f.blockId,
      JSON.stringify(changed),
      f.now,
      new Date(f.now.getTime() + 86_400_000),
    ];
    // The snapshot, digest and request hash agree with one another; only the saved source differs.
    await rawReject(
      `INSERT INTO presentation_question_suggestions_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,source_revision,output_language,source_snapshot,status,attempts,available_at,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'en',$8,'pending',0,$9,$9,$9,$10)`,
      spoofValues,
      f.actor.workspaceId,
    );
    const invalidRequestValues = [...spoofValues];
    invalidRequestValues[0] = randomUUID();
    invalidRequestValues[4] = "f".repeat(64);
    invalidRequestValues[5] = input.request.sourceDigest;
    invalidRequestValues[7] = JSON.stringify(f.source);
    await rawReject(
      `INSERT INTO presentation_question_suggestions_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,source_revision,output_language,source_snapshot,status,attempts,available_at,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'en',$8,'pending',0,$9,$9,$9,$10)`,
      invalidRequestValues,
      f.actor.workspaceId,
    );
    const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60_000)))!,
      proposal = questionProposal(claim),
      invalid = structuredClone(proposal);
    invalid.suggestions[0]!.citations[0]!.excerpt = "Invented source quotation";
    await rawReject(
      "UPDATE presentation_question_suggestions_jobs SET status='ready',source_snapshot=NULL,lease_token=NULL,lease_until=NULL,proposal=$2,proposal_hash=encode(sha256(convert_to(openround_question_suggestions_proposal_json($2::jsonb),'UTF8')),'hex') WHERE id=$1",
      [claim.id, JSON.stringify(invalid)],
      f.actor.workspaceId,
    );
    expect(
      (
        await administrator.pool.query(
          "SELECT openround_question_suggestions_proposal_json($1::jsonb) canonical",
          [JSON.stringify(proposal)],
        )
      ).rows[0]?.canonical,
    ).toBe(JSON.stringify(proposal));
    for (const prefix of ["\t", "\u00a0"]) {
      const untrimmed = { ...proposal, provider: prefix + proposal.provider };
      await rawReject(
        "UPDATE presentation_question_suggestions_jobs SET status='ready',source_snapshot=NULL,lease_token=NULL,lease_until=NULL,proposal=$2,proposal_hash=encode(sha256(convert_to(openround_question_suggestions_proposal_json($2::jsonb),'UTF8')),'hex') WHERE id=$1",
        [claim.id, JSON.stringify(untrimmed)],
        f.actor.workspaceId,
      );
    }
    expect(await f.jobs.complete({ ...questionFence(claim, f.now), proposal })).toBe(true);
    await rawReject(
      "UPDATE presentation_question_suggestions_jobs SET proposal=proposal||'{\"extraPrivatePayload\":true}'::jsonb WHERE id=$1",
      [claim.id],
      f.actor.workspaceId,
    );
    const restricted = await repository.pool.connect();
    try {
      expect(
        (
          await restricted.query(
            "SELECT id FROM presentation_question_suggestions_jobs WHERE id=$1",
            [claim.id],
          )
        ).rows,
      ).toEqual([]);
      await restricted.query("BEGIN");
      await restricted.query("SELECT set_config('app.workspace_id',$1,true)", [randomUUID()]);
      expect(
        (
          await restricted.query(
            "SELECT id FROM presentation_question_suggestions_jobs WHERE id=$1",
            [claim.id],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await restricted.query("ROLLBACK");
      restricted.release();
    }
    await repository.deleteAccount(f.actor.userId);
  });
});

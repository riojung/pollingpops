import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
import {
  PostgresRepository,
  createPresentationPracticeAssignmentRepository,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectPracticeConformance,
  expectPracticeFrozenPublication,
  expectPracticeLifecycle,
  expectPracticeAuthority,
  practiceAssignmentFixture,
} from "./support/presentation-practice-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation practice PostgreSQL", () => {
  const database = `presentation_practice_${randomUUID().replaceAll("-", "")}`;
  let repository: PostgresRepository,
    administrator: PostgresRepository,
    created = false,
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
    repository = new PostgresRepository(runtimeDatabaseUrl);
    await repository.initialize();
  });
  afterAll(async () => {
    await repository?.close();
    await administrator?.close();
    if (created) {
      const cluster = new PostgresRepository(adminUrl!);
      try {
        await cluster.pool.query(`DROP DATABASE "${database}"`);
      } finally {
        await cluster.close();
      }
    }
  });
  it("keeps frozen page/answer denominators, reconstructs answer cutoffs and fences workspace erasure", async () => {
    await expectPracticeFrozenPublication(repository);
  });
  it("persists exact private reading/response receipts and concurrent CAS under restricted RLS", async () => {
    await expectPracticeConformance(repository);
  });
  it("reopens accepted answers and reconstructs historical receipts without changing current state", async () => {
    const f = await practiceAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    const answer = {
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "answer" as const,
        blockId: f.content.blocks[1]!.id,
        choiceId: f.choices[0]!.id,
      },
      accepted = await f.write(answer);
    await f.write({
      requestId: randomUUID(),
      expectedRevision: 1,
      kind: "read",
      blockId: f.content.blocks[0]!.id,
    });
    const complete = await f.write({
      requestId: randomUUID(),
      expectedRevision: 2,
      kind: "complete",
    });
    const reopened = new PostgresRepository(runtimeDatabaseUrl),
      fresh = createPresentationPracticeAssignmentRepository(reopened);
    try {
      expect(
        (await fresh.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now))!
          .attempt,
      ).toEqual(complete.attempt);
      expect((await fresh.mutateAttempt({ ...f.start, mutation: answer })).attempt).toEqual(
        accepted.attempt,
      );
      expect(
        (await fresh.getAttempt(f.assignment.id, f.start.attemptId, f.start.tokenHash, f.now))!
          .attempt,
      ).toEqual(complete.attempt);
    } finally {
      await reopened.close();
    }
  });
  it("exports only safe assignment metadata and cascades account erasure", async () => {
    const f = await expectPracticeLifecycle(repository);
    for (const table of [
      "presentation_practice_assignments",
      "presentation_practice_attempts",
      "presentation_practice_receipts",
    ]) {
      expect(
        (
          await administrator.pool.query(
            `SELECT count(*)::integer AS count FROM ${table} WHERE ${table === "presentation_practice_assignments" ? "id" : "assignment_id"}=$1`,
            [f.assignment.id],
          )
        ).rows[0].count,
      ).toBe(0);
    }
  });
  it("keeps aggregate reporting within current creator authority despite publisher demotion and source archive", async () => {
    await expectPracticeAuthority(repository, async (actor, check) => {
      await administrator.pool.query(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [actor.workspaceId, actor.userId],
      );
      try {
        await check();
      } finally {
        await administrator.pool.query(
          "UPDATE workspace_members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
          [actor.workspaceId, actor.userId],
        );
      }
    });
  });
  it("forces workspace/assignment RLS and rejects raw identity, answer, revision, completion and receipt changes", async () => {
    const f = await practiceAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    await f.write({
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "answer",
      blockId: f.content.blocks[1]!.id,
      choiceId: f.choices[0]!.id,
    });
    const tables = [
      "presentation_practice_assignments",
      "presentation_practice_attempts",
      "presentation_practice_receipts",
    ];
    expect(
      (
        await administrator.pool.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname",
          [tables],
        )
      ).rows,
    ).toEqual(
      tables
        .sort()
        .map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })),
    );
    expect(
      (
        await repository.pool.query(
          "SELECT count(*)::integer AS count FROM presentation_practice_attempts",
        )
      ).rows[0].count,
    ).toBe(0);
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.workspace_id',$1,true),set_config('app.presentation_practice_assignment_id',$2,true)",
        [f.actor.workspaceId, randomUUID()],
      );
      expect(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM presentation_practice_attempts",
          )
        ).rows[0].count,
      ).toBe(0);
      await client.query("SELECT set_config('app.presentation_practice_assignment_id',$1,true)", [
        f.assignment.id,
      ]);
      expect(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM presentation_practice_attempts",
          )
        ).rows[0].count,
      ).toBe(1);
      const reject = async (sql: string, values: unknown[], code = "23514") => {
        await client.query("SAVEPOINT bad_practice");
        try {
          await expect(client.query(sql, values)).rejects.toMatchObject({ code });
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT bad_practice");
        }
      };
      await reject(
        "UPDATE presentation_practice_assignments SET version_id=$2 WHERE id=$1",
        [f.assignment.id, randomUUID()],
        "42501",
      );
      await reject("UPDATE presentation_practice_attempts SET revision=revision-1 WHERE id=$1", [
        f.start.attemptId,
      ]);
      await reject(
        "UPDATE presentation_practice_attempts SET token_hash=repeat('a',64),revision=revision+1 WHERE id=$1",
        [f.start.attemptId],
      );
      await reject(
        "UPDATE presentation_practice_attempts SET answers=jsonb_set(answers,ARRAY[$2::text,'choiceId'],to_jsonb($3::text)),revision=revision+1 WHERE id=$1",
        [f.start.attemptId, f.content.blocks[1]!.id, f.choices[1]!.id],
      );
      await reject(
        "UPDATE presentation_practice_attempts SET answers=jsonb_set(answers,ARRAY[$2::text,'correct'],'false'::jsonb),revision=revision+1 WHERE id=$1",
        [f.start.attemptId, f.content.blocks[1]!.id],
      );
      await reject(
        "UPDATE presentation_practice_attempts SET completed_at=updated_at,revision=revision+1 WHERE id=$1",
        [f.start.attemptId],
      );
      await reject(
        "UPDATE presentation_practice_attempts SET read_block_ids=read_block_ids||ARRAY[$2::uuid],read_revisions=read_revisions||jsonb_build_object($2::text,2),revision=revision+1,current_block_id=$2 WHERE id=$1",
        [f.start.attemptId, randomUUID()],
      );
      await reject(
        "UPDATE presentation_practice_receipts SET request_hash=repeat('a',64) WHERE attempt_id=$1",
        [f.start.attemptId],
        "42501",
      );
      for (const table of tables)
        await reject(
          `DELETE FROM ${table} WHERE ${table === "presentation_practice_assignments" ? "id" : "assignment_id"}=$1`,
          [f.assignment.id],
        );
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("rechecks expiry after waiting on locks before reads, starts, answers and exact retries", async () => {
    const f = await practiceAssignmentFixture(repository);
    for (const mode of ["read", "start", "answer", "replay"] as const) {
      const now = new Date(),
        input = { ...f.request(), now, expiresAt: new Date(now.getTime() + 450).toISOString() },
        assignment = (await f.assignments.createAssignment(input)).assignment,
        start = {
          ...f.start,
          assignmentId: assignment.id,
          assignmentTokenHash: input.tokenHash,
          attemptId: randomUUID(),
          now,
        };
      await f.assignments.startAttempt(start);
      const mutation = {
        requestId: randomUUID(),
        expectedRevision: 0,
        kind: "answer" as const,
        blockId: f.content.blocks[1]!.id,
        choiceId: f.choices[0]!.id,
      };
      if (mode === "replay") await f.assignments.mutateAttempt({ ...start, mutation });
      const blocker = await administrator.pool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM presentation_practice_assignments WHERE id=$1 FOR UPDATE",
          [assignment.id],
        );
        const action =
          mode === "read"
            ? f.assignments.getAttempt(assignment.id, start.attemptId, start.tokenHash, now)
            : mode === "start"
              ? f.assignments.startAttempt(start)
              : f.assignments.mutateAttempt({ ...start, mutation });
        const pending = action.then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        await delay(Math.max(0, assignment.expiresAt.getTime() - Date.now() + 20));
        await blocker.query("COMMIT");
        const result = await pending;
        if (mode === "read") expect(result.value).toBeNull();
        else expect(result.error).toMatchObject({ code: "UNAVAILABLE" });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
    }
  });
  it("admission serializes the final available attempt and preserves accepted starts at capacity", async () => {
    const f = await practiceAssignmentFixture(repository);
    await administrator.pool.query(
      "INSERT INTO presentation_practice_attempts(id,workspace_id,assignment_id,token_hash,revision,read_block_ids,read_revisions,answers,started_at,updated_at) SELECT gen_random_uuid(),$1,$2,repeat('c',64),0,'{}','{}','{}',statement_timestamp(),statement_timestamp() FROM generate_series(1,249)",
      [f.actor.workspaceId, f.assignment.id],
    );
    const starts = [
        { ...f.start, attemptId: randomUUID() },
        { ...f.start, attemptId: randomUUID() },
      ],
      results = await Promise.allSettled(starts.map((input) => f.assignments.startAttempt(input)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "ATTEMPT_LIMIT" },
    });
    const index = results.findIndex((result) => result.status === "fulfilled");
    expect((await f.assignments.startAttempt(starts[index]!)).replayed).toBe(true);
  });
  it("expires aggregate reporting after its retained recovery deadline and purges all private children", async () => {
    const f = await practiceAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    await f.write({
      requestId: randomUUID(),
      expectedRevision: 0,
      kind: "answer",
      blockId: f.content.blocks[1]!.id,
      choiceId: f.choices[0]!.id,
    });
    const blocker = await administrator.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL session_replication_role='replica'");
      const aged = (
        await blocker.query(
          "UPDATE presentation_practice_assignments SET created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '7 days'+interval '450 milliseconds' WHERE id=$1 RETURNING expires_at+interval '7 days' AS retention_end",
          [f.assignment.id],
        )
      ).rows[0];
      await blocker.query("COMMIT");
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM presentation_practice_assignments WHERE id=$1 FOR UPDATE",
        [f.assignment.id],
      );
      const pending = f.assignments.getPracticeInsights(
        f.actor.workspaceId,
        f.presentation.id,
        f.assignment.id,
        f.actor.userId,
        new Date(),
      );
      await delay(Math.max(0, new Date(aged.retention_end).getTime() - Date.now() + 20));
      await blocker.query("COMMIT");
      expect(await pending).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await repository.purgeExpired(new Date());
    for (const table of [
      "presentation_practice_assignments",
      "presentation_practice_attempts",
      "presentation_practice_receipts",
    ])
      expect(
        (
          await administrator.pool.query(
            `SELECT count(*)::integer AS count FROM ${table} WHERE ${table === "presentation_practice_assignments" ? "id" : "assignment_id"}=$1`,
            [f.assignment.id],
          )
        ).rows[0].count,
      ).toBe(0);
  });
  it.each([
    ["progress", "demotion"],
    ["start", "demotion"],
    ["create", "demotion"],
    ["progress", "workspace deletion"],
    ["start", "workspace deletion"],
    ["create", "workspace deletion"],
  ] as const)("rejects raw %s after waiting for concurrent %s", async (operation, boundary) => {
    const f = await practiceAssignmentFixture(repository);
    await f.assignments.startAttempt(f.start);
    const blocker = await administrator.pool.connect(),
      raw = await repository.pool.connect();
    const input = f.request(),
      insertedId = randomUUID();
    try {
      await blocker.query("BEGIN");
      if (boundary === "demotion")
        await blocker.query(
          "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
          [f.actor.workspaceId, f.actor.userId],
        );
      else
        await blocker.query(
          "UPDATE workspaces SET deletion_started_at=clock_timestamp() WHERE id=$1",
          [f.actor.workspaceId],
        );
      await raw.query("BEGIN");
      await raw.query("SET LOCAL statement_timeout='3000ms'");
      await raw.query(
        "SELECT set_config('app.workspace_id',$1,true),set_config('app.presentation_practice_assignment_id',$2,true)",
        [f.actor.workspaceId, f.assignment.id],
      );
      const pid = (await raw.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      let settled = false;
      const query =
        operation === "progress"
          ? raw.query(
              "UPDATE presentation_practice_attempts SET revision=revision+1,read_block_ids=ARRAY[$2::uuid],read_revisions=jsonb_build_object($2::text,revision+1),current_block_id=$2,updated_at=clock_timestamp() WHERE id=$1",
              [f.start.attemptId, f.content.blocks[0]!.id],
            )
          : operation === "start"
            ? raw.query(
                "INSERT INTO presentation_practice_attempts(id,workspace_id,assignment_id,token_hash,revision,read_block_ids,read_revisions,answers,started_at,updated_at) VALUES($1,$2,$3,repeat('d',64),0,'{}','{}','{}',statement_timestamp(),statement_timestamp())",
                [insertedId, f.actor.workspaceId, f.assignment.id],
              )
            : raw.query(
                "INSERT INTO presentation_practice_assignments(id,workspace_id,presentation_id,version_id,actor_id,request_id,intent_hash,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                [
                  insertedId,
                  input.workspaceId,
                  input.presentationId,
                  input.versionId,
                  input.actorId,
                  input.requestId,
                  input.intentHash,
                  input.tokenHash,
                  input.now,
                  input.expiresAt,
                ],
              );
      const pending = query.then(
        (value) => {
          settled = true;
          return { value, error: null };
        },
        (error: unknown) => {
          settled = true;
          return { value: null, error };
        },
      );
      let waiting = false;
      for (let retry = 0; retry < 100 && !settled; retry++) {
        waiting = (
          await administrator.pool.query("SELECT cardinality(pg_blocking_pids($1))>0 AS waiting", [
            pid,
          ])
        ).rows[0].waiting;
        if (waiting) break;
        await delay(10);
      }
      expect(waiting).toBe(true);
      expect(settled).toBe(false);
      await blocker.query("COMMIT");
      expect((await pending).error).toMatchObject({ code: "23514" });
      await raw.query("ROLLBACK");
      if (operation === "progress")
        expect(
          (
            await administrator.pool.query(
              "SELECT revision::integer AS revision FROM presentation_practice_attempts WHERE id=$1",
              [f.start.attemptId],
            )
          ).rows[0].revision,
        ).toBe(0);
      else
        expect(
          (
            await administrator.pool.query(
              `SELECT count(*)::integer AS count FROM ${operation === "start" ? "presentation_practice_attempts" : "presentation_practice_assignments"} WHERE id=$1`,
              [insertedId],
            )
          ).rows[0].count,
        ).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      await raw.query("ROLLBACK");
      blocker.release();
      raw.release();
    }
  });
  it.each(["page", "choice"] as const)(
    "rejects raw practice creation for legacy %s UUID case aliases",
    async (alias) => {
      const f = await practiceAssignmentFixture(repository),
        id = "abcdefab-1234-4234-8234-abcdefabcdef",
        question = f.content.blocks[1]!;
      if (question.kind !== "question" || !("choices" in question.question))
        throw new Error("Choice fixture required");
      const content = PresentationContentSchema.parse({
        ...f.content,
        blocks:
          alias === "page"
            ? [
                { ...f.content.blocks[0]!, id },
                { ...f.content.blocks[0]!, id: id.toUpperCase() },
                question,
              ]
            : [
                f.content.blocks[0],
                {
                  ...question,
                  question: {
                    ...question.question,
                    choices: question.question.choices.map((choice, index) => ({
                      ...choice,
                      id: index === 0 ? id : id.toUpperCase(),
                    })),
                  },
                },
              ],
      });
      const version = await f.presentations.publishPresentation(
        {
          ...f.version,
          id: randomUUID(),
          version: 3,
          content,
          contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
        },
        0,
      );
      expect(
        (
          await administrator.pool.query(
            "SELECT presentation_practice_content_eligible($1::jsonb) AS eligible",
            [JSON.stringify(content)],
          )
        ).rows[0].eligible,
      ).toBe(false);
      const input = { ...f.request(), versionId: version.id },
        insertedId = randomUUID(),
        raw = await repository.pool.connect();
      try {
        await raw.query("BEGIN");
        await raw.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
        await expect(
          raw.query(
            "INSERT INTO presentation_practice_assignments(id,workspace_id,presentation_id,version_id,actor_id,request_id,intent_hash,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              insertedId,
              input.workspaceId,
              input.presentationId,
              input.versionId,
              input.actorId,
              input.requestId,
              input.intentHash,
              input.tokenHash,
              input.now,
              input.expiresAt,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await raw.query("ROLLBACK");
        raw.release();
      }
      expect(
        (await f.presentations.getPresentationVersion(f.actor.workspaceId, version.id))!.content,
      ).toEqual(content);
    },
  );
});

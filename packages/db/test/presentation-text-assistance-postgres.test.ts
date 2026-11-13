import { createHash, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PresentationContentSchema,
  PresentationTextAssistanceProposalSchema,
  presentationTextAssistanceProposalHash,
  presentationTextAssistanceSourceDigest,
} from "@openround/contracts";
import {
  PostgresRepository,
  assertRestrictedRuntimeDatabasePrincipal,
  createPresentationSessionRepository,
  type PresentationSessionResponseRecord,
} from "../src/index.js";
import { preparePostgresTestRuntime } from "./support/postgres-test-runtime.js";
import {
  expectPresentationTranslationConformance,
  expectPresentationTranslationLanguageFence,
  expectPresentationTranslationUnchangedWording,
  expectPresentationTextAssistanceTargetFence,
  expectPresentationTextAssistanceLifecycle,
  expectPresentationTextAssistanceActorErasure,
  expectPresentationTextAssistanceConformance,
  expectPresentationTextAssistanceCapacity,
  expectPresentationTextAssistanceRevocation,
  presentationTextAssistanceFixture,
  textFence,
  textProposal,
  textApplication,
} from "./support/presentation-text-assistance-conformance.js";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL,
  runtimeUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!(adminUrl && runtimeUrl))("Presentation text assistance PostgreSQL", () => {
  const database = `presentation_text_assistance_${randomUUID().replaceAll("-", "")}`;
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
      (await administrator.pool.query("SELECT name FROM _openround_migrations WHERE version=102"))
        .rows,
    ).toEqual([{ name: "presentation_text_assistance" }]);
    expect(
      (
        await administrator.pool.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='presentation_text_assistance_jobs'",
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
  it("binds translation targets and original language, preserves evidence and recovers accepted document16 receipts", async () => {
    await expectPresentationTranslationConformance(repository);
  });
  it("rejects a stale original language annotation even when the exact source wording is unchanged", async () => {
    await expectPresentationTranslationLanguageFence(repository);
  });
  it("permits unchanged translated wording only with a newly selected language annotation", async () => {
    await expectPresentationTranslationUnchangedWording(repository);
  });
  it("preserves exact Unicode source and canonical JSONB proposals, version15 evidence and accepted receipts across expiry", async () => {
    const f = await expectPresentationTextAssistanceConformance(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT status,original_text,proposal,proposal_hash,created_by FROM presentation_text_assistance_jobs WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([
      {
        status: "expired",
        original_text: null,
        proposal: null,
        proposal_hash: null,
        created_by: null,
      },
    ]);
  });
  it("serializes combined outline/text active capacity and monthly admissions including consumed cross-feature identities", async () => {
    await expectPresentationTextAssistanceCapacity(repository);
  });
  it("enforces the combined active cap in both raw SQL insertion guards", async () => {
    const f = await presentationTextAssistanceFixture(repository);
    await f.outlineJobs.create(f.outlineCreate());
    await f.jobs.create(f.create());
    const statements = [
      `INSERT INTO presentation_text_assistance_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,node_id,operation,role,source_revision,original_text,status,attempts,available_at,created_at,updated_at,expires_at)
       SELECT $1,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,node_id,operation,role,source_revision,original_text,status,attempts,available_at,created_at,updated_at,expires_at FROM presentation_text_assistance_jobs WHERE workspace_id=$2 LIMIT 1`,
      `INSERT INTO presentation_assistance_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,source_name,slide_count,outline,status,attempts,available_at,created_at,updated_at,expires_at)
       SELECT $1,workspace_id,presentation_id,created_by,request_hash,source_digest,source_name,slide_count,outline,status,attempts,available_at,created_at,updated_at,expires_at FROM presentation_assistance_jobs WHERE workspace_id=$2 LIMIT 1`,
    ];
    for (const statement of statements) {
      const client = await administrator.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.workspace_id',$1,true)", [f.actor.workspaceId]);
        await expect(
          client.query(statement, [randomUUID(), f.actor.workspaceId]),
        ).rejects.toMatchObject({ code: "23514" });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    }
    expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(2);
    await repository.deleteAccount(f.actor.userId);
  });
  it("scrubs private proposals on first get or list after creator removal or downgrade", async () => {
    const scenarios = await expectPresentationTextAssistanceRevocation(repository);
    for (const scenario of scenarios)
      expect(
        (
          await administrator.pool.query(
            "SELECT original_text,proposal,proposal_hash,created_by,error_code FROM presentation_text_assistance_jobs WHERE workspace_id=$1 AND id=$2",
            [scenario.workspaceId, scenario.jobId],
          )
        ).rows,
      ).toEqual([
        {
          original_text: null,
          proposal: null,
          proposal_hash: null,
          created_by: null,
          error_code: "SOURCE_UNAVAILABLE",
        },
      ]);
  });
  it("rechecks exact target text and role under the saved-draft transaction while allowing explicit unchanged-source revision advances", async () => {
    await expectPresentationTextAssistanceTargetFence(repository);
  });
  it("fences stale leases and attempt limits, and preserves request identities after deck erasure", async () => {
    await expectPresentationTextAssistanceLifecycle(repository);
  });
  it("erases deleted-actor private data while preserving accepted receipts and compact allowance in a surviving workspace", async () => {
    const f = await expectPresentationTextAssistanceActorErasure(repository);
    expect(
      (
        await administrator.pool.query(
          "SELECT original_text,proposal,proposal_hash,created_by,error_code FROM presentation_text_assistance_jobs WHERE id=$1",
          [f.created.id],
        )
      ).rows,
    ).toEqual([
      {
        original_text: null,
        proposal: null,
        proposal_hash: null,
        created_by: null,
        error_code: "SOURCE_UNAVAILABLE",
      },
    ]);
  });
  it("rejects raw SQL identity changes, malformed proposals and dishonest metadata without weakening RLS", async () => {
    const f = await presentationTextAssistanceFixture(repository),
      createdJob = await f.jobs.create(f.create()),
      claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60000)))!;
    expect(claim.id).toBe(createdJob.job.id);
    for (const sql of [
      "UPDATE presentation_text_assistance_jobs SET request_hash=repeat('b',64) WHERE id=$1",
      "UPDATE presentation_text_assistance_jobs SET original_text='changed' WHERE id=$1",
      "UPDATE presentation_text_assistance_jobs SET node_id='another-node' WHERE id=$1",
      "UPDATE presentation_text_assistance_jobs SET attempts=0 WHERE id=$1",
      "UPDATE presentation_text_assistance_jobs SET status='ready',original_text=NULL,lease_token=NULL,lease_until=NULL,proposal='{}',proposal_hash=repeat('b',64) WHERE id=$1",
    ])
      await expect(administrator.pool.query(sql, [claim.id])).rejects.toMatchObject({
        code: "23514",
      });
    const proposal = textProposal(claim);
    await f.jobs.complete({ ...textFence(claim, f.now), proposal });
    const stored = (
      await administrator.pool.query(
        "SELECT proposal,proposal_hash FROM presentation_text_assistance_jobs WHERE id=$1",
        [claim.id],
      )
    ).rows[0];
    expect(stored.proposal).toEqual(proposal);
    await expect(
      administrator.pool.query(
        "UPDATE presentation_text_assistance_jobs SET proposal_hash=repeat('b',64) WHERE id=$1",
        [claim.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const metadata = { ...proposal };
    delete (metadata as Partial<typeof proposal>).blockId;
    delete (metadata as Partial<typeof proposal>).text;
    delete (metadata as Partial<typeof proposal>).originalText;
    const v15 = {
      ...f.presentation.draft,
      schemaVersion: 15,
      blocks: f.presentation.draft.blocks.map((block) => ({ ...block, textAssistance: metadata })),
    };
    expect(
      (
        await administrator.pool.query(
          "SELECT openround_presentation_text_assistance_valid($1::jsonb,15) AS valid",
          [JSON.stringify(v15)],
        )
      ).rows[0].valid,
    ).toBe(true);
    for (const [document, version] of [
      [{ ...v15, schemaVersion: 14 }, 14],
      [v15, 14],
      [{ ...v15, schemaVersion: 18 }, 18],
      [
        {
          ...v15,
          blocks: v15.blocks.map((block) => ({
            ...block,
            textAssistance: { ...metadata, role: null },
          })),
        },
        15,
      ],
    ] as const)
      expect(
        (
          await administrator.pool.query(
            "SELECT openround_presentation_text_assistance_valid($1::jsonb,$2) AS valid",
            [JSON.stringify(document), version],
          )
        ).rows[0].valid,
      ).toBe(false);
    // JavaScript counts an astral symbol as two UTF-16 units. Two ASCII units to one
    // emoji therefore must fail Shorten even though PostgreSQL character_length drops.
    const block = f.presentation.draft.blocks[0]!;
    if (block.kind !== "content") throw new Error("Expected native slide");
    const shortSource = {
      ...f.presentation.draft,
      blocks: [
        {
          ...block,
          scene: {
            ...block.scene!,
            nodes: block.scene!.nodes.map((node) =>
              node.id === f.nodeId ? { ...node, text: "ab" } : node,
            ),
          },
        },
      ],
    };
    const saved = (await f.presentations.updatePresentationDraft({
      workspaceId: f.actor.workspaceId,
      presentationId: f.presentation.id,
      draft: shortSource,
      expectedRevision: f.presentation.draftRevision,
      mutationId: randomUUID(),
      editorId: f.actor.userId,
      draftHash: createHash("sha256").update(JSON.stringify(shortSource)).digest("hex"),
    }))!;
    await f.jobs.create({
      ...f.create(),
      originalText: "ab",
      request: {
        ...f.request(),
        operation: "shorten",
        sourceDigest: presentationTextAssistanceSourceDigest("ab"),
        expectedRevision: saved.draftRevision,
      },
    });
    const shortening = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60000)))!;
    const emojiProposal = {
      ...textProposal(shortening, "x"),
      text: "🌱",
      outputDigest: presentationTextAssistanceSourceDigest("🌱"),
    };
    await expect(
      administrator.pool.query(
        "UPDATE presentation_text_assistance_jobs SET status='ready',original_text=NULL,lease_token=NULL,lease_until=NULL,proposal=$2::jsonb,proposal_hash=encode(sha256(convert_to(openround_presentation_text_assistance_proposal_json($2::jsonb),'UTF8')),'hex') WHERE id=$1",
        [shortening.id, JSON.stringify(emojiProposal)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      await f.jobs.complete({
        ...textFence(shortening, f.now),
        proposal: textProposal(shortening, "x"),
      }),
    ).toBe(true);
    expect(
      (
        await repository.pool.query(
          "SELECT id FROM presentation_text_assistance_jobs WHERE id=$1",
          [claim.id],
        )
      ).rows,
    ).toEqual([]);
  });
  it("enforces canonical translation languages, immutable source identity and exact proposal language bindings in raw SQL", async () => {
    const f = await presentationTextAssistanceFixture(repository);
    const input = {
      ...f.create(),
      request: {
        ...f.request(),
        operation: "translate" as const,
        targetLanguage: "fr" as const,
        sourceLanguage: null,
      },
    };
    const createdJob = await f.jobs.create(input);
    for (const [operation, target, source] of [
      ["translate", null, null],
      ["translate", "FR", null],
      ["translate", "ar", null],
      ["translate", "fr", "fr"],
      ["translate", "fr", "en"],
      ["rewrite", "fr", null],
      ["shorten", null, "en"],
    ])
      await expect(
        administrator.pool.query(
          `INSERT INTO presentation_text_assistance_jobs(id,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,node_id,operation,role,source_revision,original_text,status,attempts,available_at,created_at,updated_at,expires_at,target_language,source_language)
         SELECT $1,workspace_id,presentation_id,created_by,request_hash,source_digest,block_id,node_id,$2,role,source_revision,original_text,'pending',0,available_at,created_at,updated_at,expires_at,$3,$4 FROM presentation_text_assistance_jobs WHERE id=$5`,
          [randomUUID(), operation, target, source, createdJob.job.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60000)))!;
    for (const [column, value] of [
      ["target_language", "de"],
      ["source_language", "en"],
    ])
      await expect(
        administrator.pool.query(
          `UPDATE presentation_text_assistance_jobs SET ${column}=$2 WHERE id=$1`,
          [claim.id, value],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    const proposal = textProposal(claim, "Texte à examiner.");
    const canonical = (
      await administrator.pool.query(
        "SELECT openround_presentation_text_assistance_proposal_json($1::jsonb) AS canonical",
        [JSON.stringify(proposal)],
      )
    ).rows[0].canonical;
    expect(canonical).toBe(
      JSON.stringify(PresentationTextAssistanceProposalSchema.parse(proposal)),
    );
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(
      presentationTextAssistanceProposalHash(proposal),
    );
    for (const changed of [
      { ...proposal, targetLanguage: "de" },
      { ...proposal, sourceLanguage: "en" },
      { ...proposal, targetLanguage: "FR" },
      { ...proposal, sourceLanguage: undefined },
    ])
      await expect(
        administrator.pool.query(
          "UPDATE presentation_text_assistance_jobs SET status='ready',original_text=NULL,lease_token=NULL,lease_until=NULL,proposal=$2::jsonb,proposal_hash=encode(sha256(convert_to(openround_presentation_text_assistance_proposal_json($2::jsonb),'UTF8')),'hex') WHERE id=$1",
          [claim.id, JSON.stringify(changed)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    expect(await f.jobs.complete({ ...textFence(claim, f.now), proposal })).toBe(true);
    const translated = textApplication(f, claim.id, proposal).draft;
    expect(
      (
        await administrator.pool.query(
          "SELECT openround_presentation_languages_valid($1::jsonb,16,false) AS valid",
          [JSON.stringify(translated)],
        )
      ).rows[0].valid,
    ).toBe(true);
    for (const change of [
      "old document",
      "old scene",
      "bad language",
      "nontext language",
      "missing target",
      "wrong source language",
    ]) {
      const draft = structuredClone(translated);
      const block = draft.blocks[0]!;
      if (block.kind !== "content" || !block.scene) throw new Error("Missing scene");
      const node = block.scene.nodes.find((node) => node.id === f.nodeId)!;
      if (node.type !== "text") throw new Error("Missing text");
      let stored = 16;
      if (change === "old document") {
        draft.schemaVersion = 15;
        stored = 15;
      }
      if (change === "old scene") block.scene.schemaVersion = 6;
      if (change === "bad language") Object.assign(node, { lang: "FR" });
      if (change === "nontext language") {
        block.scene.nodes.push(
          Object.assign(
            {
              id: "Shape:Language",
              type: "shape" as const,
              shape: "rectangle" as const,
              color: "blue" as const,
              label: "A shape",
              frame: { x: 5, y: 70, width: 20, height: 15 },
            },
            { lang: "fr" },
          ),
        );
        block.scene.readingOrder.push("Shape:Language");
      }
      if (change === "missing target") delete block.textAssistance!.targetLanguage;
      if (change === "wrong source language")
        Object.assign(block.textAssistance!, { sourceLanguage: "fr" });
      await expect(
        administrator.pool.query(
          "UPDATE presentations SET draft=$2::jsonb,draft_schema_version=$3 WHERE workspace_id=$1 AND id=$4",
          [f.actor.workspaceId, JSON.stringify(draft), stored, f.presentation.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });
  it.each([15, 16] as const)(
    "retains existing response scores and exact uppercase-identity acknowledgements in composed spatial document%s sessions",
    async (documentVersion) => {
      const f = await presentationTextAssistanceFixture(repository);
      const input = f.create();
      await f.jobs.create(
        documentVersion === 16
          ? {
              ...input,
              request: {
                ...input.request,
                operation: "translate",
                targetLanguage: "fr",
                sourceLanguage: null,
              },
            }
          : input,
      );
      const claim = (await f.jobs.claim(f.now, new Date(f.now.getTime() + 60000)))!,
        proposal = textProposal(claim);
      await f.jobs.complete({ ...textFence(claim, f.now), proposal });
      const acceptedDraft = (await f.presentations.updatePresentationDraft(
        textApplication(f, claim.id, proposal),
      ))!;
      const formats = ["poll", "ranking", "open_text", "word_cloud", "single_select"] as const;
      const questionBlocks = formats.map((type) => ({
        id: randomUUID().toUpperCase(),
        kind: "question" as const,
        question: {
          id: randomUUID().toUpperCase(),
          type,
          prompt: `Frozen ${type} question`,
          purpose: type === "single_select" ? "diagnostic" : "opinion",
          confidence: "off",
          delivery: "main",
          linkedRecheckQuestionId: null,
          timeLimitSeconds: 30,
          basePoints: type === "single_select" ? 1000 : 0,
          explanation: type === "single_select" ? "The first response is correct." : "",
          mediaId: null,
          mediaAlt: null,
          ...(["poll", "ranking", "single_select"].includes(type)
            ? {
                choices: ["First", "Second", "Third"].map((label, index) => ({
                  id: randomUUID().toUpperCase(),
                  label,
                  isCorrect: type === "single_select" && index === 0,
                })),
              }
            : {}),
          ...(type === "poll" ? { maxSelections: 2 } : type === "ranking" ? { rankCount: 2 } : {}),
        },
      }));
      const editedBlock = acceptedDraft.draft.blocks[0]!;
      if (editedBlock.kind !== "content" || !editedBlock.scene)
        throw new Error("Expected accepted native text edit");
      const additions = [
        {
          id: "Metadata:Shape",
          type: "shape",
          shape: "rectangle",
          color: "blue",
          label: "Evidence",
          frame: { x: 5, y: 20, width: 20, height: 15 },
        },
        {
          id: "Metadata:Table",
          type: "table",
          caption: "Evidence counts",
          headers: ["Stage", "Count"],
          rows: [
            ["Plan", "12"],
            ["Deliver", "18"],
          ],
          frame: { x: 5, y: 40, width: 35, height: 20 },
        },
        {
          id: "Metadata:Chart",
          type: "chart",
          chartType: "bar",
          title: "Evidence counts",
          summary: "Deliveries rose from 12 to 18.",
          categories: ["Plan", "Deliver"],
          series: [{ name: "Count", values: [12, 18] }],
          frame: { x: 50, y: 40, width: 35, height: 20 },
        },
        {
          id: "Metadata:Connector",
          type: "connector",
          from: { nodeId: "Metadata:Shape", anchor: "bottom" },
          to: { nodeId: "Metadata:Table", anchor: "top" },
          label: "supports",
          color: "blue",
        },
        {
          id: "Metadata:Local",
          type: "reveal",
          scope: "local",
          label: "Show source detail",
          body: "Public local source detail",
          frame: { x: 5, y: 65, width: 25, height: 15 },
        },
        {
          id: "Metadata:Broadcast",
          type: "reveal",
          scope: "broadcast",
          label: "Presenter reveal",
          body: "Private until broadcast",
          frame: { x: 35, y: 65, width: 25, height: 15 },
        },
        {
          id: "Metadata:Navigation",
          type: "navigation",
          label: "Open the poll",
          targetBlockId: questionBlocks[0]!.id,
          frame: { x: 65, y: 65, width: 25, height: 15 },
        },
      ];
      const scene = {
        ...editedBlock.scene,
        schemaVersion: documentVersion === 16 ? 7 : 6,
        design: { theme: "ocean", font: "serif", spacing: "compact" },
        groups: [{ id: "Evidence:Group", nodeIds: ["Metadata:Table", "Metadata:Chart"] }],
        nodes: [...editedBlock.scene.nodes, ...additions],
        readingOrder: [...editedBlock.scene.readingOrder, ...additions.map(({ id }) => id)],
      };
      const blocks = [{ ...editedBlock, scene }, ...questionBlocks];
      const content = PresentationContentSchema.parse({
        ...acceptedDraft.draft,
        blocks,
        sections: [
          {
            id: randomUUID(),
            title: "Evidence and discussion",
            blockIds: blocks.map(({ id }) => id),
          },
        ],
        spatial: {
          schemaVersion: 1,
          frames: blocks.map(({ id }, index) => ({
            blockId: id,
            x: index * 1440,
            y: 100,
            width: 1280,
            height: 720,
          })),
        },
      });
      const saved = (await f.presentations.updatePresentationDraft({
        workspaceId: f.actor.workspaceId,
        presentationId: f.presentation.id,
        draft: content,
        expectedRevision: acceptedDraft.draftRevision,
        mutationId: randomUUID(),
        editorId: f.actor.userId,
        draftHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      }))!;
      const version = await f.presentations.publishPresentation(
        {
          id: randomUUID(),
          workspaceId: f.actor.workspaceId,
          presentationId: f.presentation.id,
          version: 1,
          content,
          contentSchemaVersion: documentVersion,
          contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
          sourceDraftRevision: saved.draftRevision,
          publishedAt: f.now,
        },
        saved.draftRevision,
      );
      const sessions = createPresentationSessionRepository(repository);
      for (let index = 0; index < formats.length; index++) {
        const type = formats[index]!,
          block = content.blocks[index + 1]!;
        if (block.kind !== "question") throw new Error("Expected opinion question");
        const now = new Date(),
          session = await sessions.createSession({
            id: randomUUID(),
            workspaceId: f.actor.workspaceId,
            presentationId: f.presentation.id,
            presentationVersionId: version.id,
            title: content.title,
            content,
            code: String(randomInt(1000000, 10000000)),
            status: "active",
            phase: "question_open",
            currentBlockIndex: index + 1,
            revision: 1,
            settings: { timeMode: "flex" },
            trustMode: "learning",
            eventSeq: 1,
            questionOpenedAt: now,
            questionClosesAt: null,
            createdBy: f.actor.userId,
            createdAt: now,
            updatedAt: now,
            finishedAt: null,
            liveExpiresAt: new Date(now.getTime() + 3600000),
            retentionExpiresAt: new Date(now.getTime() + 86400000),
          });
        expect(session.content.schemaVersion).toBe(documentVersion);
        expect(session.content.blocks[0]).toMatchObject({
          textAssistance: { nodeId: f.nodeId, outputDigest: proposal.outputDigest },
          scene,
        });
        expect(session.content.spatial).toEqual(content.spatial);
        expect(session.content.sections).toEqual(content.sections);
        const participantId = randomUUID();
        await sessions.addParticipant({
          id: participantId,
          workspaceId: f.actor.workspaceId,
          sessionId: session.id,
          nickname: `Opinion ${type}`,
          tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
          joinedAt: now,
          lastSeenAt: now,
        });
        const isText = type === "open_text" || type === "word_cloud",
          isScored = type === "single_select";
        const responseSchemaVersion = isText ? 3 : isScored ? 1 : 2,
          correct = isScored ? true : null,
          score = isScored ? 1000 : 0;
        const selected =
          "choices" in block.question
            ? (isScored
                ? [block.question.choices[0]!.id]
                : [block.question.choices[2]!.id, block.question.choices[0]!.id]
              ).map((id) => id.toLowerCase())
            : [];
        const response = isText
          ? { textValue: `PRIVATE_${type}_RESPONSE` }
          : type === "poll" || isScored
            ? { choiceIds: selected }
            : { orderedChoiceIds: selected };
        const record: PresentationSessionResponseRecord = {
          id: randomUUID(),
          workspaceId: f.actor.workspaceId,
          sessionId: session.id,
          participantId,
          blockId: block.id.toLowerCase(),
          questionId: block.question.id.toLowerCase(),
          response,
          responseSchemaVersion,
          correct,
          score,
          responseMs: 1000,
          submittedAt: new Date(now.getTime() + 1000),
          idempotencyKey: randomUUID(),
          requestHash: createHash("sha256").update(JSON.stringify(response)).digest("hex"),
        };
        const accepted = await sessions.acceptResponse(record, 1);
        expect(accepted).toMatchObject({
          status: "accepted",
          response: { responseSchemaVersion, correct, score },
          acknowledgement: {
            projection: {
              currentResponse: { id: record.id, responseSchemaVersion, correct, score },
            },
          },
        });
        const duplicate = await sessions.acceptResponse({ ...record, id: randomUUID() }, 0);
        expect(duplicate).toMatchObject({
          status: "duplicate",
          response: { id: record.id, responseSchemaVersion, correct, score },
          acknowledgement: {
            projection: {
              currentResponse: { id: record.id, responseSchemaVersion, correct, score },
            },
          },
        });
        expect(await sessions.listResponses(session.id)).toHaveLength(1);
        if (isText) {
          expect(accepted).toMatchObject({
            response: { response: {}, moderationStatus: "pending", moderationVersion: 0 },
          });
          expect(JSON.stringify(accepted)).not.toContain(response.textValue);
          expect(JSON.stringify(duplicate)).not.toContain(response.textValue);
        } else {
          expect(accepted).toMatchObject({ response: { response } });
          expect(duplicate).toMatchObject({ response: { response } });
        }
        expect(
          await sessions.getParticipantSnapshotProjection(
            session.id,
            participantId,
            block.id,
            true,
          ),
        ).toMatchObject({
          currentResponse: { id: record.id, responseSchemaVersion, correct, score },
          standing: { score },
        });
        expect(
          (
            await administrator.pool.query(
              "SELECT response_schema_version,correct,score FROM presentation_live_responses WHERE session_id=$1",
              [session.id],
            )
          ).rows,
        ).toEqual([{ response_schema_version: responseSchemaVersion, correct, score }]);
      }
    },
  );
  it("purges private source/proposals through the normal lifecycle without resetting shared allowance", async () => {
    const f = await presentationTextAssistanceFixture(repository);
    await f.jobs.create(f.create());
    const expiry = new Date(f.now.getTime() + 86400000);
    await repository.purgeExpired(expiry);
    expect(
      (
        await administrator.pool.query(
          "SELECT original_text,proposal,created_by,status FROM presentation_text_assistance_jobs WHERE workspace_id=$1",
          [f.actor.workspaceId],
        )
      ).rows,
    ).toEqual([{ original_text: null, proposal: null, created_by: null, status: "expired" }]);
    expect(await repository.countAuthoringJobsSince(f.actor.workspaceId, f.since)).toBe(1);
  });
});

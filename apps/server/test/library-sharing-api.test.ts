import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationContentSchema,
  PresentationDraftSchema,
  preparePresentationPublication,
  QuizContentSchema,
  type LibraryShareCreate,
  LibraryShareSummarySchema,
} from "@openround/contracts";
import { SurveyContentSchema } from "@openround/contracts/surveys";
import { surveyPagesFixture } from "../../../packages/db/test/support/survey-pages-conformance.js";
import {
  MemoryRepository,
  createLibrarySharingRepository,
  createPlatformRepository,
  createPresentationRepository,
  createSurveyRepository,
  type CreatorContext,
} from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { registerLibrarySharingRoutes } from "../src/library-sharing-routes.js";
import { MemorySessionCache } from "../src/cache.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function user(repository: MemoryRepository) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    tokenHash,
    email: `${randomUUID()}@example.test`,
    segment: "workplace",
    policyVersion: "test",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

async function fixture(
  options: { consumeAdmission?: MemorySessionCache["consumeRateLimit"] } = {},
) {
  const repository = new MemoryRepository();
  const initialOwner = await user(repository),
    initialRecipient = await user(repository),
    foreign = await user(repository);
  const platform = createPlatformRepository(repository);
  const organization = await platform.createOrganization({
    name: "Example Company",
    actorId: initialOwner.userId,
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
  const licensed = await platform.getOrganizationUserLicenses(organization.id, initialOwner.userId);
  const owner = (await repository.getCreatorByUserId(
    initialOwner.userId,
    licensed.assignments[0]!.workspaceId,
  ))!;
  const tokenHash = randomUUID();
  await platform.createOrganizationInvitation({
    organizationId: organization.id,
    actorId: owner.userId,
    email: initialRecipient.email,
    role: "member",
    tokenHash,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const accepted = await platform.acceptOrganizationInvitation({
    tokenHash,
    actorId: initialRecipient.userId,
  });
  const recipient = (await repository.getCreatorByUserId(
    initialRecipient.userId,
    accepted.workspaceId!,
  ))!;
  const shares = createLibrarySharingRepository(repository);
  const presentations = createPresentationRepository(repository),
    surveys = createSurveyRepository(repository);
  const mediaId = randomUUID();
  await repository.createMediaAsset({
    id: mediaId,
    workspaceId: owner.workspaceId,
    objectKey: `media/${owner.workspaceId}/${mediaId}.png`,
    mimeType: "image/png",
    sizeBytes: 8,
    scanStatus: "clean",
    altText: "A public diagram",
    createdAt: new Date(),
  });
  const question = {
    id: randomUUID(),
    type: "single_select" as const,
    prompt: "Public question",
    timeLimitSeconds: 30,
    basePoints: 1000,
    explanation: "PRIVATE_EXPLANATION",
    mediaId,
    mediaAlt: "Public diagram",
    choices: [
      {
        id: randomUUID(),
        label: "Public first option",
        isCorrect: true,
        feedback: "PRIVATE_FEEDBACK",
      },
      { id: randomUUID(), label: "Public second option", isCorrect: false },
    ],
    sourceCitations: [
      {
        sourceName: "PRIVATE_SOURCE",
        sourceDigest: "a".repeat(64),
        locator: "page 1",
        excerpt: "PRIVATE_CITATION",
      },
    ],
  };
  const roundContent = QuizContentSchema.parse({
    title: "Shared Round",
    description: "Public description",
    questions: [question],
  });
  const now = new Date(),
    roundId = randomUUID();
  await repository.createQuiz({
    id: roundId,
    workspaceId: owner.workspaceId,
    title: roundContent.title,
    description: roundContent.description,
    status: "draft",
    draft: roundContent,
    draftRevision: 0,
    draftSchemaVersion: 1,
    lastEditedBy: owner.userId,
    currentVersionId: null,
    folderId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  const roundVersion = await repository.publishQuiz(
    {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId: roundId,
      version: 1,
      content: roundContent,
      contentHash: createHash("sha256").update(JSON.stringify(roundContent)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    null,
    0,
  );
  const visibleBlockId = randomUUID(),
    hiddenBlockId = randomUUID();
  const slide = (id: string, hidden = false) => ({
    id,
    kind: "content" as const,
    layout: "title_body" as const,
    textElements: [
      {
        id: randomUUID(),
        role: "title" as const,
        text: hidden ? "PRIVATE_HIDDEN" : "Public slide",
        region: "top_center" as const,
        order: 0,
      },
    ],
    mediaId: hidden ? null : mediaId,
    mediaAlt: hidden ? null : "Public diagram",
    speakerNotes: "PRIVATE_NOTES",
    citations: [{ locator: "page 1", excerpt: "PRIVATE_CITATION" }],
    ...(hidden ? { hidden: true as const } : {}),
  });
  const presentationDraft = PresentationDraftSchema.parse({
    schemaVersion: 12,
    title: "Shared Presentation",
    blocks: [
      slide(visibleBlockId),
      slide(hiddenBlockId, true),
      { id: randomUUID(), kind: "question", question },
    ],
    sections: [{ id: randomUUID(), title: "PRIVATE_HIDDEN_SECTION", blockIds: [hiddenBlockId] }],
  });
  const presentationContent = PresentationContentSchema.parse(
    preparePresentationPublication(presentationDraft),
  );
  const presentation = await presentations.createPresentation({
    id: randomUUID(),
    workspaceId: owner.workspaceId,
    title: presentationContent.title,
    description: presentationContent.description,
    status: "draft",
    draft: presentationDraft,
    draftRevision: 0,
    draftSchemaVersion: 12,
    currentVersionId: null,
    folderId: null,
    publishedDraftRevision: null,
    lastEditedBy: owner.userId,
    createdAt: now,
    updatedAt: now,
  });
  const presentationVersion = await presentations.publishPresentation(
    {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: presentation.id,
      version: 1,
      content: presentationContent,
      contentHash: createHash("sha256").update(JSON.stringify(presentationContent)).digest("hex"),
      sourceDraftRevision: 0,
      publishedAt: now,
    },
    0,
  );
  const surveyContent = SurveyContentSchema.parse({
    schemaVersion: 2,
    title: "Shared Survey",
    items: [
      {
        required: true,
        question: {
          ...question,
          type: "poll",
          purpose: "opinion",
          confidence: "off",
          delivery: "main",
          basePoints: 0,
          sourceCitations: [],
          mediaId: null,
          mediaAlt: null,
          choices: question.choices.map(({ id, label }) => ({ id, label, isCorrect: false })),
        },
      },
    ],
  });
  const survey = await surveys.create(owner.workspaceId, randomUUID(), surveyContent, randomUUID());
  const surveyPublished = await surveys.publish(
    owner.workspaceId,
    survey.id,
    survey.revision,
    randomUUID(),
    null,
  );
  let actor: CreatorContext = owner;
  const storage = {
    readImage: vi.fn(async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    cloneLibraryImage: vi.fn(async () => undefined),
    deleteLibraryImageClone: vi.fn(async () => undefined),
  };
  const featureEnabled = vi.fn(async () => true);
  const app = Fastify({ logger: false });
  apps.push(app);
  await registerLibrarySharingRoutes(app, {
    repository,
    shares,
    storage,
    featureEnabled,
    auth: {
      requireUser: async () => actor,
      requireCreator: async () => actor,
      creatorFromRequest: async () => actor,
    },
    consumeAdmission: options.consumeAdmission ?? (async () => true),
    config: ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      LOG_LEVEL: "silent",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
    }),
  });
  const sources = [
    { artifactType: "round" as const, artifactId: roundId, versionId: roundVersion.id },
    {
      artifactType: "presentation" as const,
      artifactId: presentation.id,
      versionId: presentationVersion.id,
    },
    {
      artifactType: "survey" as const,
      artifactId: survey.id,
      versionId: surveyPublished.versionId!,
    },
  ];
  const publish = async (source = sources[0]!, extra: Partial<LibraryShareCreate> = {}) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/library/shares",
      payload: {
        ...source,
        requestId: randomUUID(),
        audience: "people",
        recipientIds: [recipient.userId],
        permission: "use",
        message: "Review before Friday",
        dueAt: null,
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().share;
  };
  return {
    repository,
    shares,
    presentations,
    surveys,
    owner,
    recipient,
    foreign,
    storage,
    featureEnabled,
    app,
    sources,
    mediaId,
    publish,
    setActor: (next: CreatorContext) => {
      actor = next;
    },
  };
}

describe("organization Library sharing APIs", () => {
  it("advertises paged Survey copies as unavailable while preserving accepted copy recovery", async () => {
    const f = await fixture(),
      draft = surveyPagesFixture(),
      policy = { maximumSchemaVersion: 3 as const };
    if (draft.schemaVersion !== 3) throw new Error("Expected paged Survey");
    draft.pages[0]!.title = "Read before answering";
    draft.pages[0]!.description = "Review both options.\nChoose the closest match.";
    draft.items[0]!.question.explanation = "PRIVATE_SURVEY_EXPLANATION";
    const survey = await f.surveys.create(
      f.owner.workspaceId,
      randomUUID(),
      draft,
      randomUUID(),
      policy,
    );
    const published = await f.surveys.publish(
      f.owner.workspaceId,
      survey.id,
      0,
      randomUUID(),
      null,
      policy,
    );
    const entry = await f.publish({
      artifactType: "survey",
      artifactId: survey.id,
      versionId: published.versionId!,
    });
    await f.surveys.save(
      f.owner.workspaceId,
      survey.id,
      {
        ...draft,
        pages: draft.pages.map((page) => ({
          ...page,
          description: "PRIVATE_UNPUBLISHED_INSTRUCTIONS",
        })),
        items: draft.items.map((item) => ({
          ...item,
          question: { ...item.question, prompt: "PRIVATE_UNPUBLISHED_QUESTION" },
        })),
      },
      0,
      randomUUID(),
      policy,
    );
    f.setActor(f.recipient);
    const read = await f.app.inject({ url: `/v1/library/shares/${entry.id}` });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().share).toMatchObject({
      capabilities: { view: true, copy: false },
      copyUnavailableReason: "Creating paged Survey copies is not enabled yet",
    });
    expect(read.json().surveyPages).toEqual(draft.pages);
    expect(read.json().questions.map((question: { id: string }) => question.id)).toEqual(
      draft.items.map((item) => item.question.id),
    );
    expect(read.body).not.toMatch(/PRIVATE_|isCorrect|sourceCitations|explanation/);
    const list = await f.app.inject({ url: "/v1/library/shares?scope=shared" });
    expect(list.json().shares.find((share: { id: string }) => share.id === entry.id)).toMatchObject(
      { capabilities: { copy: false } },
    );
    const requestId = randomUUID();
    const blocked = await f.app.inject({
      method: "POST",
      url: `/v1/library/shares/${entry.id}/copy`,
      payload: { requestId },
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json().error.code).toBe("SURVEY_PAGES_NOT_ENABLED");
    const source = (await f.shares.read({ actorId: f.recipient.userId, id: entry.id }))!;
    const accepted = await f.shares.copy(
      {
        actorId: f.recipient.userId,
        id: entry.id,
        destinationWorkspaceId: f.recipient.workspaceId,
        requestId,
        now: new Date(),
        maximumSurveySchemaVersion: 3,
      },
      async () => ({ snapshot: source.snapshot, mediaAssets: [] }),
    );
    const replay = await f.app.inject({
      method: "POST",
      url: `/v1/library/shares/${entry.id}/copy`,
      payload: { requestId },
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ artifactId: accepted.artifactId, replayed: true });
    expect((await f.surveys.get(f.recipient.workspaceId, accepted.artifactId))?.draft).toEqual(
      draft,
    );
  });
  it("reads all three pinned types without authoring secrets or foreign-workspace membership", async () => {
    const f = await fixture();
    const entries = [];
    for (const source of f.sources) entries.push(await f.publish(source));
    const original = (await f.repository.getQuiz(f.owner.workspaceId, f.sources[0]!.artifactId))!;
    await f.repository.updateQuiz(
      f.owner.workspaceId,
      original.id,
      { ...original.draft, title: "PRIVATE_UNPUBLISHED_DRAFT" },
      0,
      f.owner.userId,
    );
    f.setActor(f.recipient);
    for (const entry of entries) {
      const response = await f.app.inject({ url: `/v1/library/shares/${entry.id}` });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body).not.toMatch(
        /PRIVATE_|speakerNotes|sourceCitations|citations|isCorrect|explanation|snapshot|requestId|createdBy/,
      );
      expect(response.json().share).toMatchObject({
        permission: "use",
        capabilities: { view: true, copy: true, manage: false },
      });
    }
    expect(
      (await f.repository.listWorkspaces(f.recipient.userId)).some(
        (row) => row.id === f.owner.workspaceId,
      ),
    ).toBe(false);
    const shared = await f.app.inject({ url: "/v1/library/shares?scope=shared" });
    expect(shared.json().shares).toHaveLength(3);
    expect(
      (await f.app.inject({ url: "/v1/library/shares?scope=organization" })).json().shares,
    ).toHaveLength(0);
    f.setActor(f.foreign);
    expect((await f.app.inject({ url: `/v1/library/shares/${entries[0]!.id}` })).statusCode).toBe(
      404,
    );
    expect(
      (await f.app.inject({ url: "/v1/library/shares?scope=shared" })).json().shares,
    ).toHaveLength(0);
  });

  it("discovers complete metadata matches with facets, filters and bound cursors through the API", async () => {
    const f = await fixture();
    const entries = [];
    for (const source of f.sources)
      entries.push(
        await f.publish(source, {
          message: "needle%_\\ literal",
          permission: source.artifactType === "round" ? "view" : "use",
        }),
      );
    const base = Date.now();
    for (let index = 0; index < 52; index++)
      await f.shares.create({
        actorId: f.owner.userId,
        workspaceId: f.owner.workspaceId,
        input: {
          ...f.sources[0]!,
          requestId: randomUUID(),
          audience: "people",
          recipientIds: [f.recipient.userId],
          permission: "view",
          message: "newer filler",
          dueAt: null,
        },
        now: new Date(base + index + 1),
      });
    f.setActor(f.recipient);
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: `/v1/library/shares/${entries[0]!.id}/progress`,
          payload: { status: "done" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: `/v1/library/shares/${entries[1]!.id}/progress`,
          payload: { status: "in_progress" },
        })
      ).statusCode,
    ).toBe(200);
    const first = await f.app.inject({
      url: "/v1/library/shares?scope=shared&q=%20NEEDLE%20&limit=1&includeFacets=true",
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().shares).toHaveLength(1);
    expect(first.json().facets).toEqual({
      kinds: { round: 1, presentation: 1, survey: 1 },
      progress: { new: 1, in_progress: 1, done: 1 },
      permissions: { view: 1, use: 2 },
      total: 3,
    });
    expect(first.body).not.toMatch(/PRIVATE_|snapshot|recipientIds|intentHash|createdBy|requestId/);
    expect(f.storage.readImage).not.toHaveBeenCalled();
    const filtered = await f.app.inject({
      url: "/v1/library/shares?scope=shared&q=needle&kind=survey&progress=new&permission=use&sort=title_asc&limit=1&includeFacets=true",
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().shares.map((row: { id: string }) => row.id)).toEqual([entries[2]!.id]);
    expect(filtered.json().facets).toEqual({ ...first.json().facets, total: 1 });
    const literal = await f.app.inject({
      url: `/v1/library/shares?scope=shared&q=${encodeURIComponent("%_\\")}&includeFacets=true`,
    });
    expect(literal.json().facets.total).toBe(3);
    const cursor = encodeURIComponent(first.json().nextCursor);
    expect(
      (await f.app.inject({ url: `/v1/library/shares?scope=shared&q=changed&cursor=${cursor}` }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await f.app.inject({
          url: `/v1/library/shares?scope=organization&q=needle&cursor=${cursor}`,
        })
      ).statusCode,
    ).toBe(422);
    const next = await f.app.inject({
      url: `/v1/library/shares?scope=shared&q=needle&limit=1&cursor=${cursor}`,
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json()).not.toHaveProperty("facets");
    expect(next.json().shares[0].id).not.toBe(first.json().shares[0].id);
    await f.shares.revoke({
      actorId: f.owner.userId,
      id: first.json().shares[0].id,
      now: new Date(),
    });
    expect(
      (
        await f.app.inject({
          url: `/v1/library/shares?scope=shared&q=needle&cursor=${cursor}&includeFacets=true`,
        })
      ).json().facets.total,
    ).toBe(2);
    // Format creation policy changes copy capability, while authorized metadata remains discoverable.
    f.featureEnabled.mockResolvedValue(false);
    const disabled = await f.app.inject({
      url: "/v1/library/shares?scope=shared&q=needle&permission=use&includeFacets=true",
    });
    expect(
      disabled
        .json()
        .shares.every((row: { capabilities: { copy: boolean } }) => !row.capabilities.copy),
    ).toBe(true);
    expect(disabled.json().facets.total).toBeGreaterThan(0);
    f.setActor(f.foreign);
    expect(
      (
        await f.app.inject({ url: "/v1/library/shares?scope=shared&q=needle&includeFacets=true" })
      ).json().facets.total,
    ).toBe(0);
    expect(
      (
        await f.app.inject({
          url: `/v1/library/shares?scope=shared&q=needle&cursor=${cursor}&includeFacets=true`,
        })
      ).statusCode,
    ).toBe(422);
  });
  it("preserves the baseline strict list response unless facets are explicitly requested", async () => {
    const baselineListSchema = z
      .object({ shares: z.array(LibraryShareSummarySchema), nextCursor: z.string().nullable() })
      .strict();
    const f = await fixture();
    const entry = await f.publish(f.sources[0]!, { audience: "organization", recipientIds: [] });
    const list = vi.spyOn(f.shares, "list");
    for (const url of [
      "/v1/library/shares",
      "/v1/library/shares?includeFacets=false",
      "/v1/library/shares?q=Shared&kind=round&sort=title_asc",
    ]) {
      const response = await f.app.inject({ url });
      expect(response.statusCode, response.body).toBe(200);
      expect(baselineListSchema.safeParse(response.json()).success).toBe(true);
      expect(Object.keys(response.json()).sort()).toEqual(["nextCursor", "shares"]);
      expect(response.json().shares.map((share: { id: string }) => share.id)).toEqual([entry.id]);
    }
    const optedIn = await f.app.inject({ url: "/v1/library/shares?includeFacets=true" });
    expect(optedIn.statusCode, optedIn.body).toBe(200);
    expect(optedIn.json().facets).toMatchObject({ kinds: { round: 1 }, total: 1 });
    expect(list.mock.calls.every(([input]) => !("includeFacets" in input))).toBe(true);
  });
  it("validates every discovery query field without weakening legacy defaults", async () => {
    const f = await fixture();
    for (const query of [
      `q=${"x".repeat(161)}`,
      "kind=board",
      "sort=oldest",
      "permission=edit",
      "progress=started",
      "limit=0",
      "unexpected=value",
      "includeFacets=1",
      "includeFacets=TRUE",
      "includeFacets=",
      "includeFacets=true&includeFacets=false",
    ])
      expect((await f.app.inject({ url: `/v1/library/shares?${query}` })).statusCode).toBe(422);
    expect((await f.app.inject({ url: "/v1/library/shares" })).json()).toEqual({
      shares: [],
      nextCursor: null,
    });
  });
  it("creates independent drafts and images for all types and replays copies without duplicating drafts", async () => {
    const f = await fixture();
    const entries = [];
    for (const source of f.sources) entries.push(await f.publish(source));
    f.setActor(f.recipient);
    for (const entry of entries) {
      const payload = { requestId: randomUUID() };
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/library/shares/${entry.id}/copy`,
        payload,
      });
      expect(response.statusCode, response.body).toBe(201);
      const result = response.json();
      expect(result).toMatchObject({
        artifactType: entry.artifactType,
        workspaceId: f.recipient.workspaceId,
        replayed: false,
      });
      const draft =
        entry.artifactType === "round"
          ? await f.repository.getQuiz(f.recipient.workspaceId, result.artifactId)
          : entry.artifactType === "presentation"
            ? await f.presentations.getPresentation(f.recipient.workspaceId, result.artifactId)
            : await f.surveys.get(f.recipient.workspaceId, result.artifactId);
      expect(draft?.status).toBe("draft");
      expect(JSON.stringify(draft)).not.toMatch(
        /PRIVATE_NOTES|PRIVATE_CITATION|PRIVATE_SOURCE|PRIVATE_HIDDEN/,
      );
      expect(JSON.stringify(draft)).not.toContain(f.mediaId);
      const replay = await f.app.inject({
        method: "POST",
        url: `/v1/library/shares/${entry.id}/copy`,
        payload,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toMatchObject({ artifactId: result.artifactId, replayed: true });
    }
    expect(f.storage.cloneLibraryImage).toHaveBeenCalledTimes(4);
    expect(f.storage.deleteLibraryImageClone).toHaveBeenCalledTimes(2);
    for (const [source, destination] of f.storage.cloneLibraryImage.mock.calls as unknown as Array<
      [{ id: string; workspaceId: string }, { id: string; workspaceId: string }]
    >) {
      expect(destination.workspaceId).toBe(f.recipient.workspaceId);
      expect(destination.id).not.toBe(source.id);
      expect(await f.repository.getMediaAsset(f.owner.workspaceId, destination.id)).toBeNull();
    }
  });

  it("enforces view-only grants, destination capability and effective license role", async () => {
    const f = await fixture();
    const entry = await f.publish(undefined, { permission: "view" });
    f.setActor(f.recipient);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/library/shares/${entry.id}/copy`,
          payload: { requestId: randomUUID() },
        })
      ).statusCode,
    ).toBe(403);
    f.setActor({ ...f.owner, role: "viewer" });
    expect((await f.app.inject({ url: "/v1/library/share-recipients" })).statusCode).toBe(403);
    expect(
      (await f.app.inject({ method: "POST", url: "/v1/library/shares", payload: {} })).statusCode,
    ).toBe(403);
    f.setActor(f.owner);
    const usable = await f.publish();
    f.setActor({ ...f.recipient, workspaceId: f.foreign.workspaceId });
    const read = await f.app.inject({ url: `/v1/library/shares/${usable.id}` });
    expect(read.json().share.capabilities.copy).toBe(false);
    expect(read.json().share.copyUnavailableReason).toContain("Switch");
  });

  it("keeps progress recipient-specific and stops content, media and copies after revocation", async () => {
    const f = await fixture();
    const entry = await f.publish();
    f.setActor(f.recipient);
    const progress = await f.app.inject({
      method: "PUT",
      url: `/v1/library/shares/${entry.id}/progress`,
      payload: { status: "done" },
    });
    expect(progress.json().share.progress).toBe("done");
    expect(
      (await f.app.inject({ url: `/v1/library/shares/${entry.id}/media/${f.mediaId}` })).statusCode,
    ).toBe(200);
    f.setActor(f.owner);
    expect(
      (await f.app.inject({ url: `/v1/library/shares/${entry.id}` })).json().share.progress,
    ).toBe("new");
    expect(
      (await f.app.inject({ method: "DELETE", url: `/v1/library/shares/${entry.id}` })).statusCode,
    ).toBe(204);
    f.setActor(f.recipient);
    expect((await f.app.inject({ url: `/v1/library/shares/${entry.id}` })).statusCode).toBe(404);
    expect(
      (await f.app.inject({ url: `/v1/library/shares/${entry.id}/media/${f.mediaId}` })).statusCode,
    ).toBe(404);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/library/shares/${entry.id}/copy`,
          payload: { requestId: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("rechecks revocation after storage preparation and deletes only this attempt's independent objects", async () => {
    const f = await fixture();
    const entry = await f.publish();
    f.setActor(f.recipient);
    f.storage.cloneLibraryImage.mockImplementationOnce(async () => {
      await f.shares.revoke({ actorId: f.owner.userId, id: entry.id, now: new Date() });
    });
    const response = await f.app.inject({
      method: "POST",
      url: `/v1/library/shares/${entry.id}/copy`,
      payload: { requestId: randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(await f.repository.listQuizzes(f.recipient.workspaceId)).toHaveLength(0);
    expect(f.storage.deleteLibraryImageClone).toHaveBeenCalledTimes(1);
  });

  it("fences an image read against a grant revoked while storage is reading", async () => {
    const f = await fixture();
    const entry = await f.publish();
    f.setActor(f.recipient);
    f.storage.readImage.mockImplementationOnce(async () => {
      await f.shares.revoke({ actorId: f.owner.userId, id: entry.id, now: new Date() });
      return Buffer.alloc(8);
    });
    expect(
      (await f.app.inject({ url: `/v1/library/shares/${entry.id}/media/${f.mediaId}` })).statusCode,
    ).toBe(404);
  });

  it("rechecks clean source media at commit after the physical image has been prepared", async () => {
    const f = await fixture();
    const entry = await f.publish();
    f.setActor(f.recipient);
    f.storage.cloneLibraryImage.mockImplementationOnce(async () => {
      f.repository.mediaAssets.get(f.mediaId)!.scanStatus = "rejected";
    });
    const response = await f.app.inject({
      method: "POST",
      url: `/v1/library/shares/${entry.id}/copy`,
      payload: { requestId: randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(await f.repository.listQuizzes(f.recipient.workspaceId)).toHaveLength(0);
    expect(f.storage.deleteLibraryImageClone).toHaveBeenCalledTimes(1);
  });

  it("stops a copy when format creation is disabled during storage preparation", async () => {
    const f = await fixture();
    const entry = await f.publish();
    f.setActor(f.recipient);
    f.storage.cloneLibraryImage.mockImplementationOnce(async () => {
      f.featureEnabled.mockResolvedValue(false);
    });
    const response = await f.app.inject({
      method: "POST",
      url: `/v1/library/shares/${entry.id}/copy`,
      payload: { requestId: randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(await f.repository.listQuizzes(f.recipient.workspaceId)).toHaveLength(0);
    expect(f.storage.deleteLibraryImageClone).toHaveBeenCalledTimes(1);
  });

  it("bounds physical copy preparation and lets a capacity-rejected request retry with the same intent", async () => {
    const f = await fixture();
    const entry = await f.publish();
    f.setActor(f.recipient);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.storage.cloneLibraryImage.mockImplementation(async () => {
      await gate;
    });
    const copy = (requestId = randomUUID()) =>
      f.app.inject({
        method: "POST",
        url: `/v1/library/shares/${entry.id}/copy`,
        payload: { requestId },
      });
    const admitted = Array.from({ length: 4 }, () => copy());
    try {
      await vi.waitFor(() => expect(f.storage.cloneLibraryImage).toHaveBeenCalledTimes(4));
      const requestId = randomUUID();
      const busy = await copy(requestId);
      expect(busy.statusCode, busy.body).toBe(503);
      expect(busy.headers["retry-after"]).toBe("1");
      expect(busy.json().error.code).toBe("LIBRARY_COPY_BUSY");
      expect(f.storage.cloneLibraryImage).toHaveBeenCalledTimes(4);
      release();
      const completed = await Promise.all(admitted);
      for (const response of completed) expect(response.statusCode, response.body).toBe(201);
      const retry = await copy(requestId);
      expect(retry.statusCode, retry.body).toBe(201);
      expect(retry.json().replayed).toBe(false);
    } finally {
      release();
      await Promise.all(admitted);
    }
  });

  it("admits all 200 images in a valid Round within one fixed window and denies request 257 before storage", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = new MemorySessionCache();
    try {
      const f = await fixture({ consumeAdmission: cache.consumeRateLimit.bind(cache) });
      const source = f.sources[0]!;
      const round = (await f.repository.getQuiz(f.owner.workspaceId, source.artifactId))!;
      const content = QuizContentSchema.parse({
        ...round.draft,
        questions: Array.from({ length: 200 }, () => ({
          ...structuredClone(round.draft.questions[0]!),
          id: randomUUID(),
        })),
      });
      const updated = (await f.repository.updateQuiz(
        f.owner.workspaceId,
        round.id,
        content,
        0,
        f.owner.userId,
      ))!;
      const version = await f.repository.publishQuiz(
        {
          id: randomUUID(),
          workspaceId: f.owner.workspaceId,
          quizId: round.id,
          version: 2,
          content,
          sourceDraftRevision: updated.draftRevision,
          contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
          publishedAt: new Date(),
        },
        null,
        updated.draftRevision,
      );
      const entry = await f.publish({ ...source, versionId: version.id });
      f.setActor(f.recipient);
      const reader = await f.app.inject({ url: `/v1/library/shares/${entry.id}` });
      expect(reader.statusCode, reader.body).toBe(200);
      const questions: Array<{ mediaId: string }> = reader.json().questions;
      expect(questions).toHaveLength(200);
      const windowStart = Date.now();
      for (const question of questions) {
        const image = await f.app.inject({
          url: `/v1/library/shares/${entry.id}/media/${question.mediaId}`,
        });
        expect(image.statusCode, image.body).toBe(200);
      }
      expect(f.storage.readImage).toHaveBeenCalledTimes(200);
      for (let request = 201; request <= 256; request++) {
        const image = await f.app.inject({
          url: `/v1/library/shares/${entry.id}/media/${f.mediaId}`,
        });
        expect(image.statusCode, image.body).toBe(200);
      }
      const denied = await f.app.inject({
        url: `/v1/library/shares/${entry.id}/media/${f.mediaId}`,
      });
      expect(denied.statusCode, denied.body).toBe(429);
      expect(denied.json().error.code).toBe("RATE_LIMITED");
      expect(f.storage.readImage).toHaveBeenCalledTimes(256);
      expect(Date.now()).toBe(windowStart);
    } finally {
      vi.useRealTimers();
      await cache.close();
    }
  });
});

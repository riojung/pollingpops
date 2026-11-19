import { describe, expect, it, vi } from "vitest";
import {
  SurveyContentSchema,
  SURVEY_READER_HEADER,
  type SurveyResponses,
} from "@openround/contracts/surveys";
import {
  createSurveyParticipantSession,
  initialSurveyParticipantSnapshot,
  type SurveyAttempt,
} from "./survey-client";
import { surveyBranchingFixture } from "../../../packages/contracts/test/support/survey-branching-fixture";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const content = () =>
  SurveyContentSchema.parse({
    schemaVersion: 3,
    title: "Ordered feedback",
    description: "Anonymous feedback",
    items: [1, 2, 3].map((index) => ({
      required: index !== 2,
      question: {
        id: id(index),
        type: "rating",
        prompt: `Question ${index}`,
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        basePoints: 0,
        timeLimitSeconds: 30,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
        min: 1,
        max: 5,
        minLabel: "Low",
        maxLabel: "High",
      },
    })),
    pages: [1, 2, 3].map((index) => ({
      id: id(index + 10),
      title: `Page title ${index}`,
      description: `Page notes ${index}`,
      questionIds: [id(index)],
    })),
  });
const attempt = (responses: SurveyResponses = {}): SurveyAttempt => ({
  roomId: id(100),
  content: content(),
  closesAt: "2099-01-01T00:00:00.000Z",
  closed: false,
  revision: 0,
  responses,
  finalized: false,
  receipt: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(initial = attempt(), existingCredential = true) {
  let state = initialSurveyParticipantSnapshot();
  let server = structuredClone(initial);
  let currentEpoch = 0;
  let time = Date.parse("2026-11-18T12:00:00.000Z");
  const entries = new Map<string, string>(
    existingCredential ? [[`pollingpops:survey:${initial.roomId}`, "room-only-credential"]] : [],
  );
  const storage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
  };
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/public")) return { room: { passwordRequired: false } };
    if (path.endsWith("/draft") || path.endsWith("/submit")) {
      const body = JSON.parse(init!.body as string);
      server = {
        ...server,
        responses: body.responses,
        revision: body.expectedRevision + 1,
        finalized: path.endsWith("/submit"),
        receipt: path.endsWith("/submit") ? "completion-receipt" : null,
      };
    }
    return { attempt: structuredClone(server) };
  });
  const changed = vi.fn((next) => {
    state = next;
  });
  const session = createSurveyParticipantSession({
    roomId: initial.roomId,
    request: request as Parameters<typeof createSurveyParticipantSession>[0]["request"],
    storage,
    current: () => currentEpoch === 0,
    changed,
    clock: () => time,
    key: () => id(900),
  });
  return {
    session,
    request,
    storage,
    entries,
    state: () => state,
    server: () => server,
    changed,
    leave: () => {
      currentEpoch++;
    },
    close: () => {
      time = Date.parse("2100-01-01T00:00:00.000Z");
    },
    accepted: (responses: SurveyResponses, revision = 1, final = false) => ({
      attempt: {
        ...initial,
        responses,
        revision,
        finalized: final,
        receipt: final ? "completion-receipt" : null,
      },
    }),
  };
}
const answer = (value = 4) => ({ kind: "rating" as const, value });
const posts = (view: ReturnType<typeof harness>) =>
  view.request.mock.calls.filter(([, init]) => init?.method === "POST");
const choice = (question: number, selected = 1) => ({
  kind: "poll" as const,
  choiceIds: [id(question * 100 + selected)],
});
const branchingAttempt = (responses: SurveyResponses = {}): SurveyAttempt => ({
  ...attempt(responses),
  content: surveyBranchingFixture(),
});

describe("Survey participant room session", () => {
  it.each(["resume", "admission"])(
    "reads a frozen v4 %s response without flattening conditions or storing answers",
    async (mode) => {
      const future = surveyBranchingFixture();
      expect(future.pages.some((page) => page.visibleWhen)).toBe(true);
      const initial = { ...attempt(), content: future as unknown as SurveyAttempt["content"] };
      const view = harness(initial, mode === "resume");
      if (mode === "resume") await view.session.load();
      else await view.session.join();
      expect(view.state()).toMatchObject({
        attempt: { content: future },
        responses: {},
        pageIndex: 0,
        pending: false,
        error: null,
      });
      expect(view.state().attempt?.content.schemaVersion).toBe(4);
      for (const [, init] of view.request.mock.calls)
        expect(init).toMatchObject({
          credentials: "omit",
          headers: { [SURVEY_READER_HEADER]: "4" },
        });
      expect(JSON.stringify([...view.entries])).not.toContain(future.title);
      expect(JSON.stringify([...view.entries])).not.toContain("visibleWhen");
    },
  );
  it("advertises reader4 without cookies on public admission, authenticated resume and writes", async () => {
    const view = harness(attempt(), false);
    await view.session.load();
    view.session.change(id(1), answer());
    await view.session.next();
    expect(view.request.mock.calls.map(([path]) => path.split("/").at(-1))).toEqual([
      "public",
      "join",
      "draft",
    ]);
    for (const [, init] of view.request.mock.calls)
      expect(init).toMatchObject({ credentials: "omit", headers: { [SURVEY_READER_HEADER]: "4" } });
    expect(view.storage.setItem).toHaveBeenCalledOnce();
    expect([...view.entries.values()]).not.toContain("Ordered feedback");
    const reloaded = harness();
    await reloaded.session.load();
    expect(reloaded.request.mock.calls[0]![1]).toMatchObject({
      headers: { authorization: "Bearer room-only-credential", [SURVEY_READER_HEADER]: "4" },
    });
  });
  it("validates only current-page requirements and does not write or advance on failure", async () => {
    const view = harness();
    await view.session.load();
    await view.session.next();
    expect(posts(view)).toHaveLength(0);
    expect(view.state().pageIndex).toBe(0);
    expect(view.state().validation).toEqual({ [id(1)]: "required" });
    view.session.change(id(1), answer());
    await view.session.next();
    expect(view.state().pageIndex).toBe(1);
    expect(view.state().validation).toEqual({});
    await view.session.next();
    expect(view.state().pageIndex).toBe(2);
    expect(view.state().responses[id(2)]).toBeUndefined();
    expect(view.state().responses[id(3)]).toBeUndefined();
  });
  it("waits for an acknowledged full-map save before moving, singleflights and fences captured edits", async () => {
    const view = harness();
    await view.session.load();
    view.session.change(id(1), answer(3));
    const pending = deferred<ReturnType<typeof view.accepted>>();
    view.request.mockReturnValueOnce(pending.promise);
    const moving = view.session.next();
    await view.session.next();
    view.session.change(id(1), answer(5));
    view.session.back();
    expect(posts(view)).toHaveLength(1);
    expect(view.state()).toMatchObject({ pageIndex: 0, saving: true, pending: true });
    expect(JSON.parse(posts(view)[0]![1]!.body as string)).toEqual({
      expectedRevision: 0,
      idempotencyKey: id(900),
      responses: { [id(1)]: answer(3) },
    });
    pending.resolve(view.accepted({ [id(1)]: answer(3) }));
    await moving;
    expect(view.state()).toMatchObject({
      pageIndex: 1,
      saving: false,
      pending: false,
      responses: { [id(1)]: answer(3) },
    });
    view.session.change(id(1), answer(1));
    expect(view.state().responses[id(1)]).toEqual(answer(3));
  });
  it("retains the exact token, path, body and page target through lost acknowledgement and closure", async () => {
    const view = harness();
    await view.session.load();
    view.session.change(id(1), answer());
    view.request.mockRejectedValueOnce(new TypeError("Acknowledgement lost"));
    await view.session.next();
    const first = posts(view)[0]!;
    expect(view.state()).toMatchObject({ pageIndex: 0, pending: true, saving: false });
    view.entries.set(`pollingpops:survey:${id(100)}`, "another-credential");
    view.close();
    await view.session.save(true);
    await view.session.load();
    view.session.change(id(1), answer(1));
    expect(posts(view)).toHaveLength(1);
    view.request.mockResolvedValueOnce(view.accepted({ [id(1)]: answer() }));
    await view.session.retry();
    expect(posts(view)[1]).toEqual(first);
    expect(view.state()).toMatchObject({ pageIndex: 1, pending: false, notice: "saved" });
  });
  it.each(["disposed", "room-changed", "room-ABA"])(
    "ignores late saves after %s without publishing or navigating",
    async (change) => {
      const view = harness();
      await view.session.load();
      view.session.change(id(1), answer());
      const pending = deferred<ReturnType<typeof view.accepted>>();
      view.request.mockReturnValueOnce(pending.promise);
      const saving = view.session.next();
      if (change === "disposed") view.session.dispose();
      else {
        view.leave();
        if (change === "room-ABA") view.leave();
      }
      const calls = view.changed.mock.calls.length;
      pending.resolve(view.accepted({ [id(1)]: answer() }));
      await saving;
      expect(view.changed).toHaveBeenCalledTimes(calls);
    },
  );
  it("does not apply a stale admission or start a second admission while one is pending", async () => {
    const view = harness(attempt(), false);
    const pending = deferred<ReturnType<typeof view.accepted>>();
    view.request.mockImplementation(async (path) =>
      path.endsWith("/public") ? { room: { passwordRequired: true } } : pending.promise,
    );
    await view.session.load();
    const joining = view.session.join("exact password");
    await view.session.join("other password");
    expect(posts(view)).toHaveLength(1);
    expect(posts(view)[0]![1]!.body).toBe(JSON.stringify({ password: "exact password" }));
    view.leave();
    pending.resolve(view.accepted({}, 0));
    await joining;
    expect(view.state().attempt).toBeNull();
    expect([...view.entries.values()]).not.toContain("exact password");
  });
  it.each([
    "wrong-room",
    "wrong-revision",
    "invalid-content",
    "wrong-version",
    "wrong-content",
    "wrong-responses",
  ])("retains pending intent after an unverifiable %s acknowledgement", async (kind) => {
    const view = harness();
    await view.session.load();
    view.session.change(id(1), answer());
    const bad = view.accepted({ [id(1)]: answer() });
    if (kind === "wrong-room") bad.attempt.roomId = id(101);
    if (kind === "wrong-revision") bad.attempt.revision = 8;
    if (kind === "invalid-content")
      bad.attempt.content = {
        ...content(),
        schemaVersion: 99,
      } as unknown as SurveyAttempt["content"];
    if (kind === "wrong-version") bad.attempt.content = surveyBranchingFixture();
    if (kind === "wrong-content")
      bad.attempt.content = { ...content(), title: "Different frozen content" };
    if (kind === "wrong-responses") bad.attempt.responses = { [id(1)]: answer(2) };
    view.request.mockResolvedValueOnce(bad);
    await view.session.next();
    expect(view.state()).toMatchObject({ pageIndex: 0, pending: true });
    const body = posts(view)[0]![1]!.body;
    view.request.mockResolvedValueOnce(view.accepted({ [id(1)]: answer() }));
    await view.session.retry();
    expect(posts(view)[1]![1]!.body).toBe(body);
    expect(view.state().pageIndex).toBe(1);
  });
  it("preserves all page answers on Back and resumes the earliest unanswered item including optional items", async () => {
    const view = harness(attempt({ [id(1)]: answer(), [id(3)]: answer(2) }));
    await view.session.load();
    expect(view.state().pageIndex).toBe(1);
    view.session.change(id(2), answer(3));
    view.session.back();
    expect(view.state().pageIndex).toBe(0);
    expect(view.state().responses).toEqual({
      [id(1)]: answer(),
      [id(2)]: answer(3),
      [id(3)]: answer(2),
    });
    await view.session.next();
    expect(JSON.parse(posts(view)[0]![1]!.body as string).responses).toEqual(
      view.state().responses,
    );
    const complete = harness(attempt({ [id(1)]: answer(), [id(2)]: answer(), [id(3)]: answer() }));
    await complete.session.load();
    expect(complete.state().pageIndex).toBe(2);
  });
  it("allows closed-room page review without validation or new writes", async () => {
    const view = harness({ ...attempt(), closed: true });
    await view.session.load();
    view.session.change(id(1), answer());
    await view.session.next();
    expect(view.state().pageIndex).toBe(1);
    view.session.back();
    expect(view.state().pageIndex).toBe(0);
    await view.session.save(true);
    expect(posts(view)).toHaveLength(0);
    expect(view.state().responses).toEqual({});
  });
  it("keeps final submission separate and does not permit duplicate completion", async () => {
    const view = harness(attempt({ [id(1)]: answer(), [id(2)]: answer(), [id(3)]: answer() }));
    await view.session.load();
    await view.session.save(true);
    await view.session.save(true);
    expect(posts(view)).toHaveLength(1);
    expect(posts(view)[0]![0]).toBe(`/v1/survey-rooms/${id(100)}/submit`);
    expect(view.state()).toMatchObject({
      notice: "submitted",
      attempt: { finalized: true, receipt: "completion-receipt" },
    });
  });
  it("blocks a captured final submit after navigating back from the last page", async () => {
    const view = harness(attempt({ [id(1)]: answer(), [id(2)]: answer(), [id(3)]: answer() }));
    await view.session.load();
    view.session.back();
    await view.session.save(true);
    expect(view.state().pageIndex).toBe(1);
    expect(posts(view)).toHaveLength(0);
  });
  it("keeps the legacy full-form response request unchanged except for the capability header", async () => {
    const source = content();
    const legacyInput = { ...source, schemaVersion: 2 } as Record<string, unknown>;
    delete legacyInput.pages;
    const legacy = SurveyContentSchema.parse(legacyInput);
    const view = harness({ ...attempt(), content: legacy });
    await view.session.load();
    view.session.change(id(1), answer());
    await view.session.save(false);
    expect(Object.keys(JSON.parse(posts(view)[0]![1]!.body as string)).sort()).toEqual([
      "expectedRevision",
      "idempotencyKey",
      "responses",
    ]);
    expect(view.state().pageIndex).toBe(0);
  });
});

describe("conditional Survey participant session", () => {
  it("validates a required visible final page locally and exposes a focusable question error", async () => {
    const source = branchingAttempt({ [id(1)]: choice(1, 2) });
    source.content.items[3]!.required = true;
    const view = harness(source);
    await view.session.load();
    expect(view.state().pageIndex).toBe(1);
    await view.session.save(true);
    expect(view.state()).toMatchObject({
      pageIndex: 1,
      validation: { [id(4)]: "required" },
      validationRevision: 1,
      pending: false,
    });
    expect(posts(view)).toHaveLength(0);
    view.session.change(id(4), answer(2));
    await view.session.save(true);
    expect(view.state().attempt?.finalized).toBe(true);
    expect(view.state().responses).toEqual({ [id(1)]: choice(1, 2), [id(4)]: answer(2) });
  });

  it("clears cascading hidden answers with a replacement map and never restores them when reopened", async () => {
    const view = harness(
      branchingAttempt({
        [id(1)]: choice(1),
        [id(2)]: choice(2),
        [id(3)]: answer(3),
        [id(4)]: answer(4),
      }),
    );
    await view.session.load();
    expect(view.state().pageIndex).toBe(3);
    view.session.back();
    view.session.back();
    view.session.back();
    view.session.change(id(1), choice(1, 2));
    const cleaned = { [id(1)]: choice(1, 2), [id(4)]: answer(4) };
    expect(view.state().responses).toEqual(cleaned);
    await view.session.next();
    expect(view.state().pageIndex).toBe(1);
    expect(JSON.parse(posts(view)[0]![1]!.body as string)).toEqual({
      expectedRevision: 0,
      idempotencyKey: id(900),
      responses: cleaned,
    });
    view.session.back();
    view.session.change(id(1), choice(1));
    expect(view.state().responses).toEqual({ [id(1)]: choice(1), [id(4)]: answer(4) });
    await view.session.next();
    expect(view.state().pageIndex).toBe(1);
    await view.session.next();
    expect(view.state().validation).toEqual({ [id(2)]: "required" });
    expect(posts(view)).toHaveLength(2);
    view.session.change(id(2), choice(2, 2));
    await view.session.next();
    expect(view.state().pageIndex).toBe(2);
    expect(view.state().responses[id(3)]).toBeUndefined();
    await view.session.save(true);
    expect(view.state().attempt).toMatchObject({ revision: 4, finalized: true });
    expect(JSON.parse(posts(view)[3]![1]!.body as string).responses).toEqual({
      [id(1)]: choice(1),
      [id(2)]: choice(2, 2),
      [id(4)]: answer(4),
    });
  });

  it("saves and submits only visible required answers while preventing captured hidden-page edits", async () => {
    const view = harness(branchingAttempt());
    await view.session.load();
    await view.session.next();
    expect(view.state().validation).toEqual({ [id(1)]: "required" });
    view.session.change(id(2), choice(2));
    expect(view.state().responses).toEqual({});
    view.session.change(id(1), choice(1, 2));
    await view.session.next();
    expect(view.state().pageIndex).toBe(1);
    view.session.change(id(3), answer());
    expect(view.state().responses).toEqual({ [id(1)]: choice(1, 2) });
    await view.session.save(true);
    expect(view.state()).toMatchObject({ notice: "submitted", attempt: { finalized: true } });
    expect(posts(view).map(([path]) => path.split("/").at(-1))).toEqual(["draft", "submit"]);
  });

  it("restores the authoritative map and resumes the first unanswered visible item without browser answer storage", async () => {
    const saved = branchingAttempt({ [id(1)]: choice(1, 2) });
    saved.revision = 6;
    const view = harness(saved);
    await view.session.load();
    expect(view.state()).toMatchObject({
      responses: { [id(1)]: choice(1, 2) },
      pageIndex: 1,
      attempt: { revision: 6 },
    });
    view.session.change(id(4), answer());
    view.session.dispose();
    const reconnect = harness(saved);
    await reconnect.session.load();
    expect(reconnect.state().responses).toEqual({ [id(1)]: choice(1, 2) });
    expect(reconnect.state().pageIndex).toBe(1);
    expect(view.storage.setItem).not.toHaveBeenCalled();
    expect(reconnect.storage.setItem).not.toHaveBeenCalled();
    expect([...reconnect.entries]).toEqual([
      [`pollingpops:survey:${saved.roomId}`, "room-only-credential"],
    ]);
  });

  it.each(["stale-revision", "stale-answers", "wrong-condition", "wrong-version"])(
    "keeps a newer branch cleanup pending after a %s acknowledgement and retries the exact operation",
    async (kind) => {
      const oldResponses = {
        [id(1)]: choice(1),
        [id(2)]: choice(2),
        [id(3)]: answer(3),
      };
      const view = harness(branchingAttempt(oldResponses));
      await view.session.load();
      // Save a first authoritative map, then make a later cleanup at its new revision.
      await view.session.save(false);
      expect(view.state().attempt?.revision).toBe(1);
      view.session.back();
      view.session.back();
      view.session.back();
      view.session.change(id(1), choice(1, 2));
      const cleaned = { [id(1)]: choice(1, 2) };
      const bad = structuredClone(view.accepted(cleaned, 2));
      if (kind === "stale-revision") {
        bad.attempt.revision = 1;
        bad.attempt.responses = oldResponses;
      }
      if (kind === "stale-answers") bad.attempt.responses = { [id(1)]: choice(1) };
      if (kind === "wrong-condition" && bad.attempt.content.schemaVersion === 4)
        bad.attempt.content.pages[1]!.visibleWhen!.choiceId = id(102);
      if (kind === "wrong-version") bad.attempt.content = content();
      view.request.mockResolvedValueOnce(bad);
      await view.session.next();
      expect(view.state()).toMatchObject({
        pageIndex: 0,
        pending: true,
        saving: false,
        responses: cleaned,
        attempt: { revision: 1, responses: oldResponses },
      });
      const captured = posts(view)[1]!;
      expect(JSON.parse(captured[1]!.body as string).expectedRevision).toBe(1);
      view.entries.set(`pollingpops:survey:${id(100)}`, "replacement-credential");
      view.session.change(id(1), choice(1));
      view.session.back();
      await view.session.next();
      await view.session.save(true);
      await view.session.load();
      expect(posts(view)).toHaveLength(2);
      expect(view.state().responses).toEqual(cleaned);
      view.request.mockResolvedValueOnce(view.accepted(cleaned, 2));
      await view.session.retry();
      expect(posts(view)[2]).toEqual(captured);
      expect(view.state()).toMatchObject({
        pageIndex: 1,
        pending: false,
        responses: cleaned,
        attempt: { revision: 2, responses: cleaned },
      });
      // A later reconnect cannot replace that cleanup with an older saved revision.
      view.request.mockResolvedValueOnce(view.accepted(oldResponses, 1));
      await view.session.load();
      expect(view.state()).toMatchObject({
        responses: cleaned,
        attempt: { revision: 2, responses: cleaned },
      });
    },
  );

  it("reviews only retained visible pages after closure, including a finalized attempt, without new writes", async () => {
    const view = harness({
      ...branchingAttempt({ [id(1)]: choice(1, 2) }),
      closed: true,
      finalized: true,
      receipt: "retained-receipt",
    });
    await view.session.load();
    expect(view.state().pageIndex).toBe(1);
    view.session.back();
    expect(view.state().pageIndex).toBe(0);
    view.session.change(id(1), choice(1));
    await view.session.next();
    expect(view.state().pageIndex).toBe(1);
    await view.session.save(false);
    await view.session.save(true);
    expect(view.state().responses).toEqual({ [id(1)]: choice(1, 2) });
    expect(posts(view)).toHaveLength(0);
  });

  it("reviews the authoritative saved branch if closure follows an unsaved local branch change", async () => {
    const view = harness(
      branchingAttempt({ [id(1)]: choice(1), [id(2)]: choice(2), [id(3)]: answer() }),
    );
    await view.session.load();
    view.session.back();
    view.session.back();
    view.session.back();
    view.session.change(id(1), choice(1, 2));
    expect(view.state().responses).toEqual({ [id(1)]: choice(1, 2) });
    view.close();
    await view.session.next();
    await view.session.next();
    await view.session.next();
    expect(view.state().pageIndex).toBe(3);
    expect(posts(view)).toHaveLength(0);
  });
});

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

describe("Survey participant room session", () => {
  it.each(["resume", "admission"])(
    "rejects a valid proposed v4 %s response without flattening pages or enabling answers",
    async (mode) => {
      const future = surveyBranchingFixture();
      expect(future.pages.some((page) => page.visibleWhen)).toBe(true);
      const initial = { ...attempt(), content: future as unknown as SurveyAttempt["content"] };
      const view = harness(initial, mode === "resume");
      if (mode === "resume") await view.session.load();
      else await view.session.join();
      expect(view.state()).toMatchObject({
        attempt: null,
        responses: {},
        pageIndex: 0,
        pending: false,
        error: { code: "SURVEY_CLIENT_UPDATE_REQUIRED" },
      });
      view.session.change(id(1), answer());
      await view.session.next();
      await view.session.save(false);
      await view.session.save(true);
      expect(view.state().attempt).toBeNull();
      expect(view.state().responses).toEqual({});
      expect(
        view.request.mock.calls.some(
          ([path]) => path.endsWith("/draft") || path.endsWith("/submit"),
        ),
      ).toBe(false);
      for (const [, init] of view.request.mock.calls)
        expect(init).toMatchObject({
          credentials: "omit",
          headers: { [SURVEY_READER_HEADER]: "3" },
        });
      expect(JSON.stringify([...view.entries])).not.toContain(future.title);
      expect(JSON.stringify([...view.entries])).not.toContain("visibleWhen");
    },
  );
  it("advertises reader3 without cookies on public admission, authenticated resume and writes", async () => {
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
      expect(init).toMatchObject({ credentials: "omit", headers: { [SURVEY_READER_HEADER]: "3" } });
    expect(view.storage.setItem).toHaveBeenCalledOnce();
    expect([...view.entries.values()]).not.toContain("Ordered feedback");
    const reloaded = harness();
    await reloaded.session.load();
    expect(reloaded.request.mock.calls[0]![1]).toMatchObject({
      headers: { authorization: "Bearer room-only-credential", [SURVEY_READER_HEADER]: "3" },
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
  it.each(["wrong-room", "wrong-revision", "invalid-content", "future-branching"])(
    "retains pending intent after an unverifiable %s acknowledgement",
    async (kind) => {
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
      if (kind === "future-branching")
        bad.attempt.content = surveyBranchingFixture() as unknown as SurveyAttempt["content"];
      view.request.mockResolvedValueOnce(bad);
      await view.session.next();
      expect(view.state()).toMatchObject({ pageIndex: 0, pending: true });
      const body = posts(view)[0]![1]!.body;
      view.request.mockResolvedValueOnce(view.accepted({ [id(1)]: answer() }));
      await view.session.retry();
      expect(posts(view)[1]![1]!.body).toBe(body);
      expect(view.state().pageIndex).toBe(1);
    },
  );
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

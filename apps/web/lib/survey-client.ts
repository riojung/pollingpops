import {
  SURVEY_READER_HEADER,
  SurveyResponsesSchema,
  surveyResumePageIndex,
  validateSurveyPageResponses,
  validateSurveyResponses,
  type SurveyDraft,
  type SurveyResponse,
  type SurveyResponses,
} from "@openround/contracts/surveys";
import {
  MAX_SUPPORTED_SURVEY_READER_VERSION,
  SurveyReadableContentSchema,
  reconcileSurveyBranchingResponses,
  surveyBranchingResumePageId,
  surveyReadablePageViews,
  validateSurveyBranchingPageResponses,
  validateSurveyBranchingResponses,
  type SurveyReadableDraft,
} from "@openround/contracts/survey-branching";
export interface SurveyAttempt {
  roomId: string;
  content: SurveyReadableDraft;
  closesAt: string;
  closed: boolean;
  revision: number;
  responses: SurveyResponses;
  finalized: boolean;
  receipt: string | null;
}
export interface SurveyRecordView {
  id: string;
  draft: SurveyDraft;
  revision: number;
  status: "draft" | "published" | "archived";
  publishedRevision: number | null;
  versionId: string | null;
}
export function surveyAccessToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
/** getRandomValues also works on LAN HTTP development URLs, unlike randomUUID. */
export function surveyMutationKey() {
  const value = surveyAccessToken();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

export function surveyReaderHeaders(token?: string) {
  return {
    [SURVEY_READER_HEADER]: String(MAX_SUPPORTED_SURVEY_READER_VERSION),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export interface SurveyParticipantSnapshot {
  attempt: SurveyAttempt | null;
  responses: SurveyResponses;
  pageIndex: number;
  loading: boolean;
  saving: boolean;
  pending: boolean;
  passwordRequired: boolean;
  error: unknown;
  notice: "" | "saved" | "submitted";
  validation: Record<string, "required" | "invalid">;
  validationRevision: number;
}
export const initialSurveyParticipantSnapshot = (): SurveyParticipantSnapshot => ({
  attempt: null,
  responses: {},
  pageIndex: 0,
  loading: false,
  saving: false,
  pending: false,
  passwordRequired: false,
  error: null,
  notice: "",
  validation: {},
  validationRevision: 0,
});
type GuestRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
type PendingResponse = {
  path: string;
  token: string;
  body: string;
  final: boolean;
  revision: number;
  content: string;
  responses: string;
  afterPage: number;
  admission: number;
};

// JSONB may reorder object keys. Array order and every frozen content/answer value still matter.
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${fingerprint((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function resumePageIndex(content: SurveyReadableDraft, responses: SurveyResponses) {
  if (content.schemaVersion === 4) {
    const pageId = surveyBranchingResumePageId(content, responses);
    return surveyReadablePageViews(content, responses).findIndex((page) => page.id === pageId);
  }
  return content.schemaVersion === 3 ? surveyResumePageIndex(content, responses) : 0;
}

function responseValidation(
  content: SurveyReadableDraft,
  responses: SurveyResponses,
  final: boolean,
) {
  return content.schemaVersion === 4
    ? validateSurveyBranchingResponses(content, responses, final)
    : validateSurveyResponses(content, responses, final);
}

/** Answers stay in memory and on the room-scoped server attempt; only its credential is stored locally. */
export function createSurveyParticipantSession({
  roomId,
  request,
  storage,
  current,
  changed,
  key = surveyMutationKey,
  clock = Date.now,
}: {
  roomId: string;
  request: GuestRequest;
  storage: Pick<Storage, "getItem" | "setItem">;
  current: () => boolean;
  changed: (snapshot: SurveyParticipantSnapshot) => void;
  key?: () => string;
  clock?: () => number;
}) {
  let state = initialSurveyParticipantSnapshot();
  let disposed = false;
  let admission = 0;
  let token = "";
  let pending: PendingResponse | null = null;
  const active = () => !disposed && current();
  const valid = (epoch: number) => active() && admission === epoch;
  const closed = () =>
    Boolean(
      state.attempt && (state.attempt.closed || Date.parse(state.attempt.closesAt) <= clock()),
    );
  const dirty = () =>
    Boolean(
      state.attempt && JSON.stringify(state.attempt.responses) !== JSON.stringify(state.responses),
    );
  function publish(update: Partial<SurveyParticipantSnapshot>) {
    state = { ...state, ...update, pending: pending !== null };
    if (active()) changed(state);
  }
  function checkedAttempt(value: SurveyAttempt) {
    if (value.roomId !== roomId || !Number.isSafeInteger(value.revision) || value.revision < 0)
      throw new Error("The Survey response could not be verified. Retry the same operation.");
    const parsed = SurveyReadableContentSchema.safeParse(value.content);
    if (!parsed.success)
      throw Object.assign(
        new Error("This Survey needs an updated reader. Reload this page to continue."),
        { code: "SURVEY_CLIENT_UPDATE_REQUIRED" },
      );
    const content = parsed.data;
    const responses = SurveyResponsesSchema.parse(value.responses);
    if (responseValidation(content, responses, value.finalized).length)
      throw new Error("The saved Survey answers could not be verified.");
    if (
      state.attempt &&
      (fingerprint(content) !== fingerprint(state.attempt.content) ||
        value.revision < state.attempt.revision ||
        (value.revision === state.attempt.revision &&
          (fingerprint(responses) !== fingerprint(state.attempt.responses) ||
            value.finalized !== state.attempt.finalized ||
            value.receipt !== state.attempt.receipt)))
    )
      throw new Error("The Survey response could not be verified. Retry the same operation.");
    return { ...value, content, responses };
  }
  function accept(value: SurveyAttempt, resume: boolean, afterPage = state.pageIndex) {
    const attempt = checkedAttempt(value);
    publish({
      attempt,
      responses: structuredClone(attempt.responses),
      pageIndex: resume
        ? resumePageIndex(attempt.content, attempt.responses)
        : Math.min(
            afterPage,
            surveyReadablePageViews(attempt.content, attempt.responses).length - 1,
          ),
      passwordRequired: false,
      validation: {},
    });
  }
  async function admit(epoch: number, password: string) {
    const storageKey = `pollingpops:survey:${roomId}`;
    const credential = storage.getItem(storageKey) || surveyAccessToken();
    storage.setItem(storageKey, credential);
    const result = await request<{ attempt: SurveyAttempt }>(`/v1/survey-rooms/${roomId}/join`, {
      method: "POST",
      credentials: "omit",
      headers: surveyReaderHeaders(credential),
      body: JSON.stringify(password ? { password } : {}),
    });
    if (!valid(epoch)) return;
    token = credential;
    accept(result.attempt, true);
  }
  async function join(password = "") {
    if (!active() || state.loading || state.saving || pending) return;
    const epoch = ++admission;
    publish({ loading: true, error: null });
    try {
      await admit(epoch, password);
    } catch (error) {
      if (valid(epoch))
        publish({
          error,
          passwordRequired: ["PASSWORD_REQUIRED", "INVALID_PASSWORD"].includes(
            (error as { code?: string }).code ?? "",
          ),
        });
    } finally {
      if (valid(epoch)) publish({ loading: false });
    }
  }
  async function load() {
    if (!active() || state.loading || state.saving || pending) return;
    const epoch = ++admission;
    publish({ loading: true, error: null });
    try {
      const credential = storage.getItem(`pollingpops:survey:${roomId}`) ?? "";
      if (credential) {
        try {
          const result = await request<{ attempt: SurveyAttempt }>(
            `/v1/survey-rooms/${roomId}/attempt`,
            { credentials: "omit", headers: surveyReaderHeaders(credential) },
          );
          if (valid(epoch)) {
            token = credential;
            accept(result.attempt, true);
          }
          return;
        } catch (error) {
          if ((error as { code?: string }).code !== "UNAUTHORIZED") throw error;
        }
      }
      if (!valid(epoch)) return;
      const result = await request<{ room: { passwordRequired: boolean } }>(
        `/v1/survey-rooms/${roomId}/public`,
        { credentials: "omit", headers: surveyReaderHeaders() },
      );
      if (!valid(epoch)) return;
      if (result.room.passwordRequired) publish({ passwordRequired: true });
      else await admit(epoch, "");
    } catch (error) {
      if (valid(epoch)) publish({ error });
    } finally {
      if (valid(epoch)) publish({ loading: false });
    }
  }
  async function persist(operation: PendingResponse) {
    if (!active() || state.saving || state.loading || operation.admission !== admission) return;
    publish({ saving: true, error: null, validation: {} });
    try {
      const result = await request<{ attempt: SurveyAttempt }>(operation.path, {
        method: "POST",
        credentials: "omit",
        headers: surveyReaderHeaders(operation.token),
        body: operation.body,
      });
      if (!valid(operation.admission) || pending !== operation) return;
      const accepted = checkedAttempt(result.attempt);
      if (
        accepted.revision !== operation.revision + 1 ||
        accepted.finalized !== operation.final ||
        fingerprint(accepted.content) !== operation.content ||
        fingerprint(accepted.responses) !== operation.responses
      )
        throw new Error(
          "The Survey save acknowledgement could not be verified. Retry the same operation.",
        );
      pending = null;
      accept(accepted, false, operation.afterPage);
      publish({ notice: operation.final ? "submitted" : "saved" });
    } catch (error) {
      if (!valid(operation.admission) || pending !== operation) return;
      const status = (error as { status?: number }).status;
      if (
        typeof status === "number" &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status)
      )
        pending = null;
      publish({ error });
    } finally {
      if (valid(operation.admission)) publish({ saving: false });
    }
  }
  async function save(final: boolean, afterPage = state.pageIndex) {
    if (
      !active() ||
      !state.attempt ||
      state.attempt.finalized ||
      state.loading ||
      state.saving ||
      pending ||
      closed()
    )
      return;
    if (
      final &&
      state.attempt.content.schemaVersion >= 3 &&
      state.pageIndex !== surveyReadablePageViews(state.attempt.content, state.responses).length - 1
    )
      return;
    if (final && state.attempt.content.schemaVersion === 4) {
      const issues = validateSurveyBranchingResponses(state.attempt.content, state.responses, true);
      if (issues.length) {
        const validation: SurveyParticipantSnapshot["validation"] = {};
        for (const issue of issues)
          if (issue.questionId)
            validation[issue.questionId] = issue.code === "required" ? "required" : "invalid";
        const pages = surveyReadablePageViews(state.attempt.content, state.responses);
        const firstInvalid = pages.findIndex((page) =>
          page.items.some((item) => validation[item.question.id]),
        );
        publish({
          validation,
          validationRevision: state.validationRevision + 1,
          ...(firstInvalid >= 0 ? { pageIndex: firstInvalid } : {}),
        });
        return;
      }
    }
    const responses = SurveyResponsesSchema.parse(state.responses);
    pending = {
      path: `/v1/survey-rooms/${roomId}/${final ? "submit" : "draft"}`,
      token,
      body: JSON.stringify({
        expectedRevision: state.attempt.revision,
        idempotencyKey: key(),
        responses,
      }),
      final,
      revision: state.attempt.revision,
      content: fingerprint(state.attempt.content),
      responses: fingerprint(responses),
      afterPage,
      admission,
    };
    await persist(pending);
  }
  async function next() {
    if (!active() || !state.attempt || state.loading || state.saving || pending) return;
    const responses = closed() ? state.attempt.responses : state.responses;
    const pages = surveyReadablePageViews(state.attempt.content, responses);
    if (state.pageIndex >= pages.length - 1) return;
    if (closed()) {
      publish({ pageIndex: state.pageIndex + 1, validation: {} });
      return;
    }
    const page = pages[state.pageIndex]!;
    const issues =
      state.attempt.content.schemaVersion === 4
        ? validateSurveyBranchingPageResponses(state.attempt.content, state.responses, page.id!)
        : validateSurveyPageResponses(state.attempt.content, state.responses, page.id);
    if (issues.length) {
      const validation: SurveyParticipantSnapshot["validation"] = {};
      for (const item of page.items) {
        const response = state.responses[item.question.id];
        const one: SurveyDraft = {
          schemaVersion: 2,
          title: state.attempt.content.title,
          description: "",
          category: state.attempt.content.category,
          experiencePreset: state.attempt.content.experiencePreset,
          items: [item],
        };
        if (
          validateSurveyResponses(one, response ? { [item.question.id]: response } : {}, true)
            .length
        )
          validation[item.question.id] = response ? "invalid" : "required";
      }
      publish({ validation, validationRevision: state.validationRevision + 1 });
      return;
    }
    await save(false, state.pageIndex + 1);
  }
  return {
    load,
    join,
    save,
    next,
    snapshot: () => state,
    dirty,
    retry: async () => {
      if (pending) await persist(pending);
    },
    back() {
      if (active() && !state.loading && !state.saving && !pending && state.pageIndex > 0)
        publish({ pageIndex: state.pageIndex - 1, validation: {} });
    },
    change(questionId: string, response?: SurveyResponse) {
      if (
        !active() ||
        !state.attempt ||
        state.attempt.finalized ||
        state.loading ||
        state.saving ||
        pending ||
        closed() ||
        !state.attempt.content.items.some((item) => item.question.id === questionId)
      )
        return;
      if (
        state.attempt.content.schemaVersion >= 3 &&
        !surveyReadablePageViews(state.attempt.content, state.responses)[
          state.pageIndex
        ]?.items.some((item) => item.question.id === questionId)
      )
        return;
      const responses = { ...state.responses };
      if (response) responses[questionId] = response;
      else delete responses[questionId];
      const validation = { ...state.validation };
      delete validation[questionId];
      const cleaned =
        state.attempt.content.schemaVersion === 4
          ? SurveyResponsesSchema.parse(
              reconcileSurveyBranchingResponses(state.attempt.content, responses).responses,
            )
          : responses;
      const eligible = new Set(
        surveyReadablePageViews(state.attempt.content, cleaned).flatMap((page) =>
          page.items.map((item) => item.question.id),
        ),
      );
      for (const id of Object.keys(validation)) if (!eligible.has(id)) delete validation[id];
      publish({ responses: cleaned, validation, notice: "" });
    },
    dispose() {
      disposed = true;
      admission++;
      pending = null;
      state = initialSurveyParticipantSnapshot();
    },
  };
}

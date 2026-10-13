import { describe, expect, it } from "vitest";
import {
  filterSessionRows,
  presentationSessionStatus,
  readSessionsView,
  roundSessionsPath,
  sessionActions,
  sessionFiltersForType,
  sessionFiltersFromQuery,
  sessionsHref,
  sessionsViewStorageKey,
  surveySessionStatus,
  writeSessionsView,
  type SessionFilters,
  type SessionType,
  type SurveySessionSummary,
} from "./session-controls";

const defaults: SessionFilters = {
  type: "rounds",
  query: "",
  status: "all",
  sourceId: "all",
  from: "",
  to: "",
};
const now = new Date("2026-10-13T12:00:00Z").getTime();
const roundId = "10000000-0000-4000-8000-000000000001";
const legacyRoundId = "10000000-0000-4000-8000-000000000002";
const presentationId = "20000000-0000-4000-8000-000000000001";
const surveyId = "30000000-0000-4000-8000-000000000001";
const otherSurveyId = "30000000-0000-4000-8000-000000000002";
const otherSurveyRoomId = "40000000-0000-4000-8000-000000000002";
const survey: SurveySessionSummary = {
  id: "40000000-0000-4000-8000-000000000001",
  surveyId,
  title: "Feedback",
  code: "1234567",
  closesAt: "2026-10-14T12:00:00Z",
  expiresAt: "2026-11-13T12:00:00Z",
  closed: false,
};

describe("Sessions controls", () => {
  it("reads typed deep links, validates dates and status, and defaults to Rounds", () => {
    expect(sessionFiltersFromQuery(new URLSearchParams(), true)).toEqual(defaults);
    expect(
      sessionFiltersFromQuery(
        new URLSearchParams(
          `type=surveys&q=x&status=finished&source=${surveyId}&from=2026-10-01&to=2026-10-13`,
        ),
        true,
      ),
    ).toEqual({
      type: "surveys",
      query: "x",
      status: "finished",
      sourceId: surveyId,
      from: "2026-10-01",
      to: "2026-10-13",
    });
    expect(
      sessionFiltersFromQuery(
        new URLSearchParams("type=unknown&status=draft&from=2026-02-30&to=tomorrow"),
        true,
      ),
    ).toEqual(defaults);
    expect(
      sessionFiltersFromQuery(
        new URLSearchParams(`type=presentations&source=${presentationId}&from=2026-10-01`),
        false,
      ),
    ).toEqual(defaults);
    expect(
      sessionFiltersFromQuery(new URLSearchParams({ q: "x".repeat(200) }), true).query,
    ).toHaveLength(160);
  });

  it.each(["", " ", "\t\n", "round", "not-a-uuid", "/v1/sessions", ` ${roundId} `])(
    "normalizes invalid source %j without forwarding it to session URLs or requests",
    (source) => {
      const filters = sessionFiltersFromQuery(
        new URLSearchParams({ type: "rounds", source }),
        true,
      );

      expect(filters).toEqual(defaults);
      expect(sessionsHref(filters)).toBe("/sessions?type=rounds");
      expect(roundSessionsPath(filters)).toBe("/v1/sessions?limit=25");
    },
  );

  it.each(["", " ", "\t\n", "quiz-one", "not-a-uuid", "/v1/quizzes"])(
    "normalizes invalid legacy quizId %j without forwarding it to session URLs or requests",
    (quizId) => {
      const filters = sessionFiltersFromQuery(
        new URLSearchParams({ type: "rounds", quizId }),
        true,
      );

      expect(filters).toEqual(defaults);
      expect(sessionsHref(filters)).toBe("/sessions?type=rounds");
      expect(roundSessionsPath(filters)).toBe("/v1/sessions?limit=25");
    },
  );

  it.each<[SessionType, string]>([
    ["rounds", roundId],
    ["presentations", presentationId],
    ["surveys", surveyId],
  ])("preserves valid UUID sources for %s", (type, source) => {
    const filters = sessionFiltersFromQuery(new URLSearchParams({ type, source }), true);

    expect(filters.sourceId).toBe(source);
    expect(new URLSearchParams(sessionsHref(filters).split("?")[1]).get("source")).toBe(source);
    expect(sessionFiltersFromQuery(new URLSearchParams({ type, source: "all" }), true)).toEqual({
      ...defaults,
      type,
    });
  });

  it.each(["", " ", "not-a-uuid", "all"])(
    "keeps explicit source %j ahead of a valid legacy quizId",
    (source) => {
      const filters = sessionFiltersFromQuery(
        new URLSearchParams({ source, quizId: legacyRoundId }),
        true,
      );

      expect(filters.sourceId).toBe("all");
      expect(roundSessionsPath(filters)).toBe("/v1/sessions?limit=25");
    },
  );

  it("uses a valid legacy UUID only when source is absent and preserves an explicit valid UUID", () => {
    expect(
      sessionFiltersFromQuery(new URLSearchParams({ quizId: legacyRoundId }), true).sourceId,
    ).toBe(legacyRoundId);
    expect(
      sessionFiltersFromQuery(new URLSearchParams({ source: roundId, quizId: legacyRoundId }), true)
        .sourceId,
    ).toBe(roundId);
    expect(sessionFiltersFromQuery(new URLSearchParams({ quizId: "all" }), true)).toEqual(defaults);
  });

  it("serializes only session filters and resets source and date semantics when changing tabs", () => {
    const filters: SessionFilters = {
      ...defaults,
      query: "x & y",
      sourceId: roundId,
      from: "2026-10-01",
      status: "expired",
    };
    expect(sessionsHref(filters)).toBe(
      `/sessions?type=rounds&q=x+%26+y&status=expired&source=${roundId}&from=2026-10-01`,
    );
    expect(sessionFiltersForType(filters, "surveys")).toEqual({
      ...defaults,
      type: "surveys",
      query: "x & y",
      status: "expired",
    });
  });

  it("sends Round search and every active filter with the pagination cursor", () => {
    const path = roundSessionsPath(
      {
        ...defaults,
        query: "  later page  ",
        status: "finished",
        sourceId: roundId,
        from: "2026-10-01",
        to: "2026-10-13",
      },
      "cursor & value",
    );
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("search")).toBe("later page");
    expect(params.get("limit")).toBe("25");
    expect(params.get("status")).toBe("finished");
    expect(params.get("quizId")).toBe(roundId);
    expect(params.get("cursor")).toBe("cursor & value");
    expect(params.get("from")).toBe(new Date("2026-10-01T00:00:00").toISOString());
    expect(params.get("to")).toBe(new Date("2026-10-13T23:59:59.999").toISOString());
  });

  it("prioritizes expired Survey access over early closure and closing deadlines", () => {
    expect(surveySessionStatus(survey, now)).toBe("active");
    expect(surveySessionStatus({ ...survey, closed: true }, now)).toBe("finished");
    expect(surveySessionStatus({ ...survey, closesAt: "2026-10-12T00:00:00Z" }, now)).toBe(
      "finished",
    );
    expect(
      surveySessionStatus({ ...survey, expiresAt: "2026-10-13T12:00:00Z", closed: true }, now),
    ).toBe("expired");
  });

  it("filters Survey title or code using the closing date and source", () => {
    const rows = [
      survey,
      {
        ...survey,
        id: otherSurveyRoomId,
        title: "Earlier",
        surveyId: otherSurveyId,
        closesAt: "2026-10-10T12:00:00Z",
      },
    ];
    const metadata = (row: SurveySessionSummary) => ({
      sourceId: row.surveyId,
      status: surveySessionStatus(row, now),
      date: row.closesAt,
    });
    expect(
      filterSessionRows(
        rows,
        { ...defaults, type: "surveys", query: "FEEDBACK", from: "2026-10-14", to: "2026-10-14" },
        metadata,
      ),
    ).toEqual([survey]);
    expect(
      filterSessionRows(
        rows,
        {
          ...defaults,
          type: "surveys",
          query: "1234",
          sourceId: otherSurveyId,
          status: "finished",
        },
        metadata,
      ).map((row) => row.id),
    ).toEqual([otherSurveyRoomId]);
    expect(
      filterSessionRows(rows, { ...defaults, type: "surveys", status: "expired" }, metadata),
    ).toEqual([]);
  });

  it("uses the live expiry for Presentation statuses", () => {
    const presentation = {
      id: "50000000-0000-4000-8000-000000000001",
      presentationId,
      title: "Slides",
      code: "1234567",
      status: "active" as const,
      phase: "lobby",
      currentBlockIndex: -1,
      blockCount: 1,
      participantCount: 0,
      responseCount: 0,
      createdAt: "2026-10-01T00:00:00Z",
    };
    expect(presentationSessionStatus(presentation, now)).toBe("active");
    expect(
      presentationSessionStatus({ ...presentation, liveExpiresAt: "2026-10-12T00:00:00Z" }, now),
    ).toBe("expired");
  });

  it("keeps viewer browsing, editor sharing, and owner deletion boundaries", () => {
    expect(sessionActions("surveys", "active", "editor")).toEqual({
      canResume: false,
      canManageSharing: true,
      canViewSurveyResults: true,
      canDelete: false,
    });
    expect(sessionActions("surveys", "active", "viewer").canManageSharing).toBe(false);
    expect(sessionActions("surveys", "finished", "owner").canDelete).toBe(true);
    expect(sessionActions("surveys", "expired", "owner")).toEqual({
      canResume: false,
      canManageSharing: false,
      canViewSurveyResults: false,
      canDelete: true,
    });
    expect(sessionActions("rounds", "active", "viewer").canResume).toBe(false);
    expect(sessionActions("rounds", "active", "owner").canDelete).toBe(false);
    expect(sessionActions("presentations", "finished", "editor").canDelete).toBe(false);
  });

  it("persists layout separately from Library and other workspaces, tolerating blocked storage", () => {
    const values = new Map([["openround:round-library-view:v1:workspace-a", "list"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(readSessionsView(storage, "workspace-a")).toBe("grid");
    writeSessionsView(storage, "workspace-a", "list");
    expect(readSessionsView(storage, "workspace-a")).toBe("list");
    expect(readSessionsView(storage, "workspace-b")).toBe("grid");
    expect(sessionsViewStorageKey("workspace-a")).toBe("openround:sessions-view:v1:workspace-a");
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readSessionsView(blocked, "workspace-a")).toBe("grid");
    expect(() => writeSessionsView(blocked, "workspace-a", "list")).not.toThrow();
  });
});

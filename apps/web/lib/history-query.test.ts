import { describe, expect, it } from "vitest";
import { buildHistoryQuery } from "./history-query";

describe("history query", () => {
  it("omits neutral filters and includes a cursor", () => {
    const query = buildHistoryQuery(
      { status: "all", quizId: "all", fromDate: "", toDate: "" },
      "next-page",
    );

    expect(Object.fromEntries(query)).toEqual({ limit: "25", cursor: "next-page" });
  });

  it("serializes status, Round, and inclusive local date boundaries", () => {
    const query = buildHistoryQuery({
      status: "ready",
      quizId: "00000000-0000-4000-8000-000000000001",
      fromDate: "2026-09-17",
      toDate: "2026-09-18",
    });

    expect(query.get("status")).toBe("ready");
    expect(query.get("quizId")).toBe("00000000-0000-4000-8000-000000000001");
    expect(query.get("from")).toBe(new Date("2026-09-17T00:00:00").toISOString());
    expect(query.get("to")).toBe(new Date("2026-09-18T23:59:59.999").toISOString());
  });

  it("preserves a literal title search on subsequent history pages", () => {
    const filters = { status: "all", quizId: "all", fromDate: "", toDate: "" };
    expect(
      buildHistoryQuery({ ...filters, search: "  100%_Round  " }, "next-page").get("search"),
    ).toBe("100%_Round");
    expect(buildHistoryQuery({ ...filters, search: "   " }).has("search")).toBe(false);
  });
});

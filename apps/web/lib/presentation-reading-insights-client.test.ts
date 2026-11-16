import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadReadingInsightsCsv,
  fetchReadingInsights,
  readingInsightCount,
  readingInsightsCsv,
  verifyReadingInsights,
} from "./presentation-reading-insights-client";
import type { PresentationReadingReport } from "@openround/contracts";

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = { presentationId: id(1), assignmentId: id(2), versionId: id(3) };
function report(): PresentationReadingReport {
  return {
    schemaVersion: 1,
    assignment: {
      id: source.assignmentId,
      mode: "reading",
      versionId: source.versionId,
      createdAt: "2026-11-08T12:00:00.000Z",
      expiresAt: "2026-11-09T12:00:00.000Z",
      revokedAt: null,
    },
    generatedAt: "2026-11-08T12:30:00.000Z",
    minimumAttempts: 5,
    startedAttempts: 10,
    completedAttempts: 0,
    inProgressAttempts: 10,
    pages: [
      { blockId: id(4), pageNumber: 1, readAttempts: null },
      { blockId: id(5), pageNumber: 2, readAttempts: 0 },
    ],
  };
}
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("creator reading insights client", () => {
  it("uses a canonical creator path, cookie authentication, no cache and the caller abort signal", async () => {
    const fetch = vi.fn().mockResolvedValue(response(report()));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(
      fetchReadingInsights(
        {
          presentationId: source.presentationId.toUpperCase(),
          assignmentId: source.assignmentId.toUpperCase(),
          versionId: source.versionId.toUpperCase(),
        },
        signal,
      ),
    ).resolves.toEqual(report());
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/v1/presentations/${source.presentationId}/assignments/${source.assignmentId}/insights`,
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
        headers: { accept: "application/json" },
      }),
    );
  });
  it("rejects invalid source IDs before fetching and rejects cross-assignment or cross-version reports", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchReadingInsights(
        { ...source, assignmentId: "../../another-assignment" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not be verified");
    expect(fetch).not.toHaveBeenCalled();
    for (const assignment of [
      { ...report().assignment, id: id(9) },
      { ...report().assignment, versionId: id(9) },
    ]) {
      fetch.mockResolvedValueOnce(response({ ...report(), assignment }));
      await expect(fetchReadingInsights(source, new AbortController().signal)).rejects.toThrow(
        "could not be verified",
      );
    }
  });
  it("does not accept a late response after the caller aborts", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((accept) => {
            resolve = accept;
          }),
      ),
    );
    const controller = new AbortController();
    const pending = fetchReadingInsights(source, controller.signal);
    controller.abort();
    resolve(response(report()));
    await expect(pending).rejects.toThrow();
  });
  it("rejects unsuppressed small/complement counts, private fields, or unbounded pages", () => {
    const value = report();
    for (const invalid of [
      { ...value, startedAttempts: 4 },
      { ...value, completedAttempts: 1, inProgressAttempts: 9 },
      { ...value, pages: [{ blockId: id(4), pageNumber: 1, readAttempts: 9 }] },
      { ...value, attemptIds: [id(90)] },
      {
        ...value,
        pages: Array.from({ length: 201 }, (_, i) => ({
          blockId: id(i + 10),
          pageNumber: i + 1,
          readAttempts: null,
        })),
      },
    ])
      expect(() => verifyReadingInsights(invalid, source)).toThrow("could not be verified");
  });
  it("exports only the exact validated snapshot with Suppressed distinct from recorded zero", () => {
    const value = report(),
      csv = readingInsightsCsv(value, source);
    expect(readingInsightCount(null)).toBe("Suppressed");
    expect(readingInsightCount(0)).toBe("0");
    expect(csv).toContain('"Observed at (UTC)","2026-11-08T12:30:00.000Z"');
    expect(csv).toContain('"Started attempts","10"');
    expect(csv).toContain('"Completed attempts","0"');
    expect(csv).toContain('"Page 1","Suppressed"');
    expect(csv).toContain('"Page 2","0"');
    expect(csv).not.toMatch(/attemptId|token|speakerNotes|currentBlockId|updatedAt|completedAt/);
    expect(() =>
      readingInsightsCsv({ ...value, generatedAt: '\t=HYPERLINK("secret")' }, source),
    ).toThrow();
    expect(() =>
      readingInsightsCsv(
        { ...value, assignment: { ...value.assignment, id: "=FORMULA()" } },
        source,
      ),
    ).toThrow();
    expect(() => readingInsightsCsv(value, { ...source, versionId: id(9) })).toThrow();
  });
  it("rejects page counts that reveal a small group after subtracting visible completed attempts", () => {
    const unsafe = {
      ...report(),
      startedAttempts: 15,
      completedAttempts: 5,
      inProgressAttempts: 10,
      pages: [{ blockId: id(4), pageNumber: 1, readAttempts: 6 }],
    };
    expect(() => verifyReadingInsights(unsafe, source)).toThrow("could not be verified");
    expect(() => readingInsightsCsv(unsafe, source)).toThrow("could not be verified");
  });
  it("creates a bounded local CSV and releases its object URL even when download fails", () => {
    vi.useFakeTimers();
    const anchor = { click: vi.fn(), remove: vi.fn(), href: "", download: "" };
    const append = vi.fn();
    vi.stubGlobal("document", { createElement: () => anchor, body: { append } });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:reading-copy");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const release = downloadReadingInsightsCsv(readingInsightsCsv(report(), source));
    expect(anchor).toMatchObject({
      href: "blob:reading-copy",
      download: "polling-pops-reading-insights.csv",
    });
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    release();
    release();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:reading-copy");
    anchor.click.mockImplementationOnce(() => {
      throw new Error("Download failed");
    });
    expect(() => downloadReadingInsightsCsv("safe")).toThrow("Download failed");
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(() => downloadReadingInsightsCsv("x".repeat(256 * 1024 + 1))).toThrow("download limit");
    expect(create).toHaveBeenCalledTimes(2);
  });
});

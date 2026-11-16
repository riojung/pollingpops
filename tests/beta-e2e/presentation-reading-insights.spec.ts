import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  PresentationAssignmentCreatedSchema,
  PresentationReadingReportSchema,
} from "../../packages/contracts/src/index.ts";
import {
  clickEditorAction,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

interface Reader {
  attemptId: string;
  token: string;
  revision: number;
}
const privateMarker = "PRIVATE_READING_INSIGHTS_BODY_AND_NOTES";
async function startReader(
  request: APIRequestContext,
  assignmentId: string,
  token: string,
): Promise<Reader> {
  const reader = {
    attemptId: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    revision: 0,
  };
  const response = await request.post(
    `${e01ApiUrl}/v1/presentation-assignments/${assignmentId}/attempts`,
    {
      headers: { authorization: `Bearer ${token}` },
      data: { attemptId: reader.attemptId, token: reader.token },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return reader;
}
async function progressReader(
  request: APIRequestContext,
  assignmentId: string,
  reader: Reader,
  blockId?: string,
) {
  const response = await request.post(
    `${e01ApiUrl}/v1/presentation-assignments/${assignmentId}/attempts/${reader.attemptId}/progress`,
    {
      headers: { authorization: `Bearer ${reader.token}` },
      data: {
        requestId: randomUUID(),
        expectedRevision: reader.revision,
        ...(blockId ? { kind: "read", blockId } : { kind: "complete" }),
      },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  reader.revision++;
}

for (const suffix of ["", " @mobile"]) {
  test(`creator reading insights preserve suppression, explicit snapshots and local CSV${suffix}`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(180_000);
    await signInBeta(page);
    const first = e01Slide(privateMarker),
      second = e01Slide("Reading final page");
    first.speakerNotes = privateMarker;
    const record = await createE01Deck(page, [first, second]);
    const publish = await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
      data: { expectedDraftRevision: record.draftRevision },
    });
    expect(publish.status()).toBe(200);
    const versionId = (await publish.json()).version.id as string;
    const token = randomBytes(32).toString("base64url");
    const create = await page.request.post(
      `${e01ApiUrl}/v1/presentations/${record.id}/assignments`,
      {
        data: {
          requestId: randomUUID(),
          token,
          versionId,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    );
    expect(create.status()).toBe(201);
    const created = PresentationAssignmentCreatedSchema.parse(await create.json());
    const path = `/v1/presentations/${record.id}/assignments/${created.assignment.id}/insights`;
    let insightRequests = 0;
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === path) insightRequests++;
    });
    await enterE01Editor(page, record.id, (info.project.use.viewport?.width ?? 1280) <= 700);
    await clickEditorAction(page, "Assign reading");
    const dialog = page.getByRole("dialog", { name: "Assign a reading assignment", exact: true });
    await dialog.getByRole("button", { name: "Reading insights", exact: true }).click();
    const insights = dialog.getByRole("region", { name: "Reading insights", exact: true });
    await expect(
      insights.getByRole("button", { name: "Load reading insights", exact: true }),
    ).toBeVisible();
    expect(insightRequests).toBe(0);
    async function load(label: string) {
      const received = page.waitForResponse((res) => new URL(res.url()).pathname === path);
      await insights.getByRole("button", { name: label, exact: true }).click();
      const raw = await (await received).json();
      expect(JSON.stringify(raw)).not.toContain(privateMarker);
      expect(JSON.stringify(raw)).not.toMatch(
        /"(?:attemptId|token|speakerNotes|readBlockIds|completedAt|updatedAt)"\s*:/,
      );
      const snapshot = PresentationReadingReportSchema.parse(raw);
      await expect(
        insights.getByRole("button", { name: "Export reading CSV", exact: true }),
      ).toBeVisible();
      return snapshot;
    }
    // Preview requests never create an attempt.
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request.get(`${e01ApiUrl}/v1/presentation-assignments/${created.assignment.id}`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status(),
      ).toBe(200);
    const empty = await load("Load reading insights");
    expect(empty.startedAttempts).toBeNull();
    expect(empty.pages.every((row) => row.readAttempts === null)).toBe(true);
    const readers: Reader[] = [];
    for (let i = 0; i < 4; i++)
      readers.push(await startReader(request, created.assignment.id, token));
    const small = await load("Refresh reading insights");
    expect(small.startedAttempts).toBeNull();
    readers.push(await startReader(request, created.assignment.id, token));
    await progressReader(request, created.assignment.id, readers[0]!, first.id);
    const started = await load("Refresh reading insights");
    expect(started).toMatchObject({
      startedAttempts: 5,
      completedAttempts: 0,
      inProgressAttempts: 5,
    });
    expect(started.pages.map((row) => row.readAttempts)).toEqual([null, 0]);
    const coverage = insights.getByRole("region", { name: "Page reading coverage", exact: true });
    await expect(
      coverage.getByRole("row", { name: "Page 1 Suppressed", exact: true }),
    ).toBeVisible();
    await expect(coverage.getByRole("row", { name: "Page 2 0", exact: true })).toBeVisible();
    await progressReader(request, created.assignment.id, readers[0]!, second.id);
    await progressReader(request, created.assignment.id, readers[0]!);
    const partial = await load("Refresh reading insights");
    expect(partial).toMatchObject({
      startedAttempts: 5,
      completedAttempts: null,
      inProgressAttempts: null,
    });
    const requestsBeforeChange = insightRequests;
    for (let i = 0; i < 5; i++)
      readers.push(await startReader(request, created.assignment.id, token));
    for (const reader of readers.slice(1, 5)) {
      await progressReader(request, created.assignment.id, reader, first.id);
      await progressReader(request, created.assignment.id, reader, second.id);
      await progressReader(request, created.assignment.id, reader);
    }
    // The UI and CSV keep the observed snapshot until an explicit refresh.
    expect(insightRequests).toBe(requestsBeforeChange);
    await expect(insights).toContainText(partial.generatedAt);
    const downloadEvent = page.waitForEvent("download");
    await insights.getByRole("button", { name: "Export reading CSV", exact: true }).click();
    const download = await downloadEvent;
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv).toContain(partial.generatedAt);
    expect(csv).toContain('"Started attempts","5"');
    expect(csv).toContain('"Completed attempts","Suppressed"');
    for (const secret of [
      token,
      privateMarker,
      ...readers.flatMap((reader) => [reader.attemptId, reader.token]),
    ])
      expect(csv).not.toContain(secret);
    expect(insightRequests).toBe(requestsBeforeChange);
    const final = await load("Refresh reading insights");
    expect(final).toMatchObject({
      startedAttempts: 10,
      completedAttempts: 5,
      inProgressAttempts: 5,
    });
    expect(final.pages.map((row) => row.readAttempts)).toEqual([5, 5]);
    expect(final.assignment.versionId).toBe(versionId);
    await dialog.getByRole("button", { name: "Revoke assignment", exact: true }).click();
    const assignmentRow = dialog.getByRole("listitem");
    await expect(assignmentRow.getByText("Revoked", { exact: false })).toBeVisible();
    await expect(
      assignmentRow.getByRole("button", { name: "Revoke assignment", exact: true }),
    ).toBeDisabled();
    expect((await load("Refresh reading insights")).assignment.revokedAt).not.toBeNull();
    const axe = await new AxeBuilder({ page })
      .include("dialog[open]")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await insights.screenshot({ path: info.outputPath("reading-insights.png") });
    // Closing and re-opening requires a fresh explicit load, with no cached report/export state.
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await clickEditorAction(page, "Assign reading");
    await dialog.getByRole("button", { name: "Reading insights", exact: true }).click();
    await expect(
      insights.getByRole("button", { name: "Load reading insights", exact: true }),
    ).toBeVisible();
    await expect(
      insights.getByRole("button", { name: "Export reading CSV", exact: true }),
    ).toHaveCount(0);
  });
}

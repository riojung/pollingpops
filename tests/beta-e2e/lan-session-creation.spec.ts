import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function publishedSource(page: Page, kind: "round" | "presentation") {
  const created = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(created.status()).toBe(201);
  const { quiz } = await created.json();
  const published = await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: quiz.draftRevision ?? 0 },
  });
  expect(published.status()).toBe(200);
  if (kind === "round") return quiz.id as string;

  const presentationResponse = await page.request.post(`${api}/v1/presentations`, {
    data: { title: "Synthetic LAN lobby regression" },
  });
  expect(presentationResponse.status()).toBe(201);
  const { presentation } = await presentationResponse.json();
  const saved = await page.request.put(`${api}/v1/presentations/${presentation.id}/draft`, {
    data: {
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
      draft: {
        ...presentation.draft,
        blocks: [{ id: randomUUID(), kind: "question", question: quiz.draft.questions[0] }],
      },
    },
  });
  expect(saved.status()).toBe(200);
  const result = await page.request.post(`${api}/v1/presentations/${presentation.id}/publish`, {
    data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision },
  });
  expect(result.status()).toBe(200);
  return presentation.id as string;
}

for (const kind of ["round", "presentation"] as const) {
  test(`${kind} lobby creation recovers from preparation errors and works without randomUUID`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: undefined,
      });
    });
    await signInBeta(page);
    const source = await publishedSource(page, kind);
    const endpoint = kind === "round" ? "/v1/sessions" : "/v1/presentation-sessions";
    await page.goto(kind === "round" ? `/host/setup/${source}` : `/presentation/${source}/host`);
    const button = page.getByRole("button", {
      name: kind === "round" ? "Create live session" : "Start live session",
      exact: true,
    });
    await expect(button).toBeEnabled();
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
    let requests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url() === `${api}${endpoint}`) requests++;
    });
    await page.evaluate(() => {
      Object.defineProperty(globalThis.crypto, "getRandomValues", {
        configurable: true,
        value: () => {
          throw new Error("Synthetic random source failure");
        },
      });
    });
    await button.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic random source failure" }),
    ).toHaveText("Synthetic random source failure");
    await expect(button).toBeEnabled();
    expect(requests).toBe(0);

    await page.evaluate(() => Reflect.deleteProperty(globalThis.crypto, "getRandomValues"));
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" && candidate.url() === `${api}${endpoint}`,
    );
    await button.click();
    const created = await response;
    expect(created.status()).toBe(201);
    expect(created.request().headers()["x-idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const body = await created.json();
    const sessionId =
      kind === "round" ? body.sessionId : (body.snapshot.sessionId ?? body.snapshot.id);
    await expect(page).toHaveURL(
      new RegExp(
        kind === "round" ? `/host/${sessionId}$` : `/presentation-session/${sessionId}/host$`,
      ),
    );
    expect(requests).toBe(1);
  });
}

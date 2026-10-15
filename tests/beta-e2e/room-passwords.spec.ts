import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const web = `http://127.0.0.1:${Number(process.env.BETA_E2E_WEB_PORT ?? 3200)}`;

async function publishedSources(page: Page) {
  const roundResponse = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
    data: {},
  });
  expect(roundResponse.status()).toBe(201);
  const { quiz } = await roundResponse.json();
  expect(
    (
      await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
        data: { expectedDraftRevision: quiz.draftRevision ?? 0 },
      })
    ).status(),
  ).toBe(200);

  const presentationResponse = await page.request.post(`${api}/v1/presentations`, {
    data: { title: `Synthetic protected Presentation ${randomUUID().slice(0, 8)}` },
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
        blocks: [
          {
            id: randomUUID(),
            kind: "question",
            question: quiz.draft.questions[0],
          },
        ],
      },
    },
  });
  expect(saved.status()).toBe(200);
  expect(
    (
      await page.request.post(`${api}/v1/presentations/${presentation.id}/publish`, {
        data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision },
      })
    ).status(),
  ).toBe(200);

  const surveyResponse = await page.request.post(`${api}/v1/surveys`, {
    data: {
      title: `Synthetic protected Survey ${randomUUID().slice(0, 8)}`,
      templateId: "training-feedback",
      idempotencyKey: randomUUID(),
    },
  });
  expect(surveyResponse.status()).toBe(201);
  const { survey } = await surveyResponse.json();
  expect(
    (
      await page.request.post(`${api}/v1/surveys/${survey.id}/publish`, {
        data: { expectedRevision: survey.revision, idempotencyKey: randomUUID() },
      })
    ).status(),
  ).toBe(200);
  return {
    round: quiz.id as string,
    presentation: presentation.id as string,
    survey: survey.id as string,
  };
}

async function expectPasswordNotStored(page: Page, password: string) {
  expect(page.url()).not.toContain(encodeURIComponent(password));
  const stored = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(stored).not.toContain(password);
}

for (const mobile of [false, true]) {
  test(`${mobile ? "@mobile " : ""}paid launches protect all three room types and admit only the intended password`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await signInBeta(page);
    await page.waitForLoadState("networkidle");
    const sources = await publishedSources(page);
    const surveyRooms: Array<{ id: string; code: string; password: string }> = [];
    const launches = [
      {
        kind: "round",
        path: `/host/setup/${sources.round}`,
        endpoint: "/v1/sessions",
        button: "Create live session",
      },
      {
        kind: "presentation",
        path: `/presentation/${sources.presentation}/host`,
        endpoint: "/v1/presentation-sessions",
        button: "Start live session",
      },
      {
        kind: "survey",
        path: `/surveys/${sources.survey}`,
        endpoint: `/v1/surveys/${sources.survey}/rooms`,
        button: "Create sharing link",
      },
    ];

    for (const launch of launches) {
      const password = randomBytes(20).toString("hex");
      await page.goto(launch.path);
      if (launch.kind === "round") await page.getByText("Review settings", { exact: true }).click();
      const protect = page.getByRole("checkbox", {
        name: "Require a password for this run",
        exact: true,
      });
      await expect(protect).toBeEnabled();
      await expect(protect).not.toBeChecked();
      await protect.check();
      const passwordField = page.getByLabel("Room password", { exact: true });
      await expect(passwordField).toHaveAttribute("type", "password");
      await passwordField.fill(password);
      const [created] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === launch.endpoint,
        ),
        page.getByRole("button", { name: launch.button, exact: true }).click(),
      ]);
      expect(created.status()).toBe(201);
      expect(created.request().postDataJSON().joinPassword).toBe(password);
      const createdBody = await created.json();
      expect(JSON.stringify(createdBody)).not.toContain(password);
      expect(JSON.stringify(createdBody)).not.toContain("joinPasswordHash");
      const room =
        launch.kind === "round"
          ? { id: createdBody.sessionId as string, code: createdBody.code as string }
          : launch.kind === "presentation"
            ? { id: createdBody.snapshot.id as string, code: createdBody.snapshot.code as string }
            : (createdBody.room as { id: string; code: string });
      await expect(page).toHaveURL(
        new RegExp(
          launch.kind === "round"
            ? `/host/${room.id}$`
            : launch.kind === "presentation"
              ? `/presentation-session/${room.id}/host$`
              : `/surveys/rooms/${room.id}$`,
        ),
      );
      await expectPasswordNotStored(page, password);
      if (launch.kind === "survey") surveyRooms.push({ ...room, password });

      const audience = await browser.newContext({
        baseURL: web,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        isMobile: mobile,
        hasTouch: mobile,
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      try {
        const participant = await audience.newPage();
        await participant.goto(`/join?code=${room.code}`);
        const joinPassword = participant.getByLabel("Room password", { exact: true });
        await expect(joinPassword).toBeVisible();
        if (launch.kind === "presentation")
          await participant
            .getByLabel("Nickname", { exact: true })
            .fill(`Guest ${randomUUID().slice(0, 8)}`);
        await joinPassword.fill(randomBytes(20).toString("hex"));
        await participant.locator('form button[type="submit"]').click();
        await expect(
          participant.getByRole("alert").filter({ hasText: "That password is incorrect" }),
        ).toBeVisible();
        await expect(participant).toHaveURL(/\/join\?code=/);
        await expectPasswordNotStored(participant, password);
        if (launch.kind === "round") {
          await participant.setViewportSize({ width: 320, height: 844 });
          expect((await new AxeBuilder({ page: participant }).analyze()).violations).toEqual([]);
          await expect
            .poll(() =>
              participant.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            )
            .toBe(true);
          await participant.screenshot({
            path: test.info().outputPath("protected-room-join-dark-320.png"),
            fullPage: true,
          });
        }
        await joinPassword.fill(password);
        await participant.locator('form button[type="submit"]').click();
        await expect(participant).toHaveURL(
          new RegExp(
            launch.kind === "round"
              ? `/play/${room.id}$`
              : launch.kind === "presentation"
                ? `/presentation-session/${room.id}/play$`
                : `/survey/${room.id}$`,
          ),
        );
        if (launch.kind === "survey")
          await expect(
            participant.getByRole("button", { name: "Submit Survey", exact: true }),
          ).toBeVisible();
        await expectPasswordNotStored(participant, password);
        await participant.reload();
        await expect(participant.getByLabel("Room password", { exact: true })).toHaveCount(0);
        if (launch.kind === "survey")
          await expect(
            participant.getByRole("button", { name: "Submit Survey", exact: true }),
          ).toBeVisible();
      } finally {
        await audience.close();
      }
    }

    // A direct Survey URL uses the same protection without going through the code page.
    const direct = await browser.newContext({ baseURL: web });
    try {
      const participant = await direct.newPage();
      const room = surveyRooms[0]!;
      await participant.goto(`/survey/${room.id}`);
      await expect(
        participant.getByRole("button", { name: "Submit Survey", exact: true }),
      ).toHaveCount(0);
      const passwordField = participant.getByLabel("Room password", { exact: true });
      await expect(passwordField).toBeVisible();
      await passwordField.fill(randomBytes(20).toString("hex"));
      await participant.getByRole("button", { name: "Join room", exact: true }).click();
      await expect(
        participant.getByRole("alert").filter({ hasText: "That password is incorrect" }),
      ).toBeVisible();
      await passwordField.fill(room.password);
      await participant.getByRole("button", { name: "Join room", exact: true }).click();
      await expect(
        participant.getByRole("button", { name: "Submit Survey", exact: true }),
      ).toBeVisible();
      await expectPasswordNotStored(participant, room.password);
      await participant.reload();
      await expect(
        participant.getByRole("button", { name: "Submit Survey", exact: true }),
      ).toBeVisible();
      await expect(participant.getByLabel("Room password", { exact: true })).toHaveCount(0);
    } finally {
      await direct.close();
    }
  });

  test(`${mobile ? "@mobile " : ""}Free workspaces launch open Rounds and cannot bypass the password paywall`, async ({
    page,
    browser,
  }) => {
    await signInBeta(page, `synthetic-free-${randomUUID()}@example.test`);
    await page.waitForLoadState("networkidle");
    const source = await page.request.post(`${api}/v1/starters/new-hire-knowledge-check/use`, {
      data: {},
    });
    expect(source.status()).toBe(201);
    const { quiz } = await source.json();
    expect(
      (
        await page.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
          data: { expectedDraftRevision: quiz.draftRevision ?? 0 },
        })
      ).status(),
    ).toBe(200);
    await page.goto(`/host/setup/${quiz.id}`);
    await expect(page.getByText(/Password protection is available with Pro/)).toBeVisible();
    await expect(page.getByLabel("Room password", { exact: true })).toHaveCount(0);
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/sessions",
      ),
      page.getByRole("button", { name: "Create live session", exact: true }).click(),
    ]);
    expect(created.status()).toBe(201);
    const body = created.request().postDataJSON();
    expect(body.joinPassword).toBeUndefined();
    const room = await created.json();
    const forbidden = await page.request.post(`${api}/v1/sessions`, {
      data: { ...body, joinPassword: randomBytes(20).toString("hex") },
    });
    expect(forbidden.status()).toBe(402);
    expect((await forbidden.json()).error.code).toBe("ENTITLEMENT_LIMIT");
    const audience = await browser.newContext({ baseURL: web });
    try {
      const participant = await audience.newPage();
      await participant.goto(`/join?code=${room.code}`);
      const join = participant.getByRole("button", { name: "Join Round", exact: true });
      await expect(join).toBeEnabled();
      await expect(participant.getByLabel("Room password", { exact: true })).toHaveCount(0);
      await join.click();
      await expect(participant).toHaveURL(new RegExp(`/play/${room.sessionId}$`));
    } finally {
      await audience.close();
    }
  });
}

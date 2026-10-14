import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInBeta } from "./sign-in";
import { joinBetaRound } from "./round-join";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
const expectedClientProfile = {
  protocolVersion: 3,
  capabilities: [
    "poll.multiselect",
    "response.ranking",
    "response.open_text",
    "response.word_cloud",
  ],
};

function observeProfiles(page: Page) {
  const profiles: Array<{ type: string; profile: unknown }> = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      const wire = frame.payload.toString();
      if (!wire.startsWith("42")) return;
      const start = wire.indexOf("[");
      if (start < 0) return;
      const [type, input] = JSON.parse(wire.slice(start));
      if (["sync.request", "answer.submit", "host.command"].includes(type)) {
        // Retain only public capability metadata, never bearer credentials or responses.
        profiles.push({ type, profile: input.clientCapabilities });
      }
    }),
  );
  return profiles;
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`Round protocol supports host, presenter, answer and refresh ${suffix}`, async ({
    page,
    browser,
  }) => {
    test.skip(process.env.BETA_E2E_ROUND_PROTOCOL !== "true", "Opt-in protocol-v7 writer test");
    test.setTimeout(90_000);
    await signInBeta(page);
    const choiceId = randomUUID();
    const created = await page.request.post(`${apiUrl}/v1/quizzes`, {
      data: { title: "Protocol browser journey" },
    });
    expect(created.status()).toBe(201);
    const quizId = (await created.json()).quiz.id;
    expect(
      (
        await page.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
          data: {
            title: "Protocol browser journey",
            description: "",
            questions: [
              {
                id: randomUUID(),
                type: "true_false",
                prompt: "A saved answer survives refresh.",
                choices: [
                  { id: choiceId, label: "True", isCorrect: true },
                  { id: randomUUID(), label: "False", isCorrect: false },
                ],
                timeLimitSeconds: 300,
                basePoints: 100,
                explanation: "Durable responses survive refresh.",
                mediaId: null,
                mediaAlt: null,
              },
            ],
          },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (await page.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, { data: {} })).ok(),
    ).toBeTruthy();
    const hostProfiles = observeProfiles(page);
    await page.goto(`/host/setup/${quizId}`);
    const sessionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/sessions",
    );
    await page.getByRole("button", { name: "Create live session" }).click();
    const response = await sessionResponse;
    expect(response.request().postDataJSON().clientCapabilities).toEqual(expectedClientProfile);
    const session = await response.json();
    expect(session.snapshot).toMatchObject({
      stateSchemaVersion: 7,
      roundProtocol: { minimumClientVersion: 2, requiredCapabilities: [] },
    });
    await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize()!,
      reducedMotion: "reduce",
    });
    try {
      const guest = await guestContext.newPage();
      const guestProfiles = observeProfiles(guest);
      await guest.goto(`/join?code=${session.code}`);
      const joinResponse = await joinBetaRound(guest);
      expect(joinResponse.request().postDataJSON().clientCapabilities).toEqual(
        expectedClientProfile,
      );
      await expect(guest).toHaveURL(/\/play\//);
      const presenterPromise = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Presenter view" }).click();
      const presenter = await presenterPromise;
      await expect(presenter.locator(".session-code")).toContainText(session.code);
      await page.getByRole("button", { name: "Start round" }).click();
      await expect(
        guest.getByRole("heading", { name: "A saved answer survives refresh." }),
      ).toBeVisible();
      await expect(
        presenter.getByRole("heading", { name: "A saved answer survives refresh.", exact: true }),
      ).toBeVisible();
      await guest.getByRole("button", { name: "True", exact: true }).click();
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(guest.getByText("Answer received and saved.")).toBeVisible();
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.reload();
      await expect(guest.getByText("Answer received and saved.")).toBeVisible();
      await expect(
        guest.getByText("Durable responses survive refresh.", { exact: true }),
      ).toHaveCount(0);
      expect(guestProfiles.some(({ type }) => type === "answer.submit")).toBe(true);
      expect(
        guestProfiles.filter(({ type }) => type === "sync.request").length,
      ).toBeGreaterThanOrEqual(2);
      for (const { profile } of [...guestProfiles, ...hostProfiles])
        expect(profile).toEqual(expectedClientProfile);
      await page.getByRole("button", { name: "Lock answers" }).click();
      await page.getByRole("button", { name: "Reveal answer" }).click();
      await expect(guest.getByText("Correct", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Finish round" }).click();
      await expect(
        page.getByTestId("host-command-bar").getByRole("link", { name: "Open report" }),
      ).toBeVisible();
      await presenter.close();
    } finally {
      await guestContext.close();
    }
  });
}

import { randomUUID } from "node:crypto";
import type { SessionSnapshot } from "@openround/contracts";
import { expect, test } from "@playwright/test";
import { signInCreator } from "../support/creator-auth";
import { testEmail } from "./test-email";

const apiUrl = "http://127.0.0.1:4100";

test("legacy private answer drafts remain submittable when confidence is turned off", async ({
  browser,
  page: host,
}, testInfo) => {
  await signInCreator(host, testEmail("legacy-confidence-toggle", testInfo), {
    returnTo: "/dashboard",
  });
  const correctChoiceId = randomUUID();
  const created = await host.request.post(`${apiUrl}/v1/quizzes`, {
    data: { title: "Legacy optional confidence toggle" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const quizId = (await created.json()).quiz.id as string;
  const draft = await host.request.patch(`${apiUrl}/v1/quizzes/${quizId}`, {
    data: {
      title: "Legacy optional confidence toggle",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          purpose: "diagnostic",
          prompt: "What is two plus two?",
          confidence: "required",
          choices: [
            { id: correctChoiceId, label: "Four", isCorrect: true },
            { id: randomUUID(), label: "Five", isCorrect: false },
          ],
          timeLimitSeconds: 300,
          basePoints: 1_000,
          explanation: "Two pairs make four.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    },
  });
  expect(draft.ok(), await draft.text()).toBe(true);
  const published = await host.request.post(`${apiUrl}/v1/quizzes/${quizId}/publish`, {
    data: {},
  });
  expect(published.ok(), await published.text()).toBe(true);
  const hosted = await host.request.post(`${apiUrl}/v1/sessions`, {
    data: {
      quizId,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
        confidenceEnabled: true,
      },
    },
  });
  expect(hosted.status(), await hosted.text()).toBe(201);
  const session = (await hosted.json()) as {
    sessionId: string;
    code: string;
    hostToken: string;
    snapshot: SessionSnapshot;
  };
  expect(session.snapshot.uxBeta).toBe(false);
  const joined = await host.request.post(`${apiUrl}/v1/sessions/join`, {
    data: { code: session.code, nickname: "Confidence learner" },
  });
  expect(joined.status(), await joined.text()).toBe(201);
  const guest = (await joined.json()) as { participantId: string; participantToken: string };
  await host.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, session);
  await host.goto(`/host/${session.sessionId}`);
  await expect(host.locator(".live-shell")).toHaveAttribute("data-ux-beta", "false");
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");

  const participantContext = await browser.newContext({
    baseURL: new URL(host.url()).origin,
    viewport: host.viewportSize()!,
  });
  const participant = await participantContext.newPage();
  try {
    await participant.addInitScript(
      ({ sessionId, participantToken }) => {
        sessionStorage.setItem(`openround:participant:${sessionId}`, participantToken);
      },
      { sessionId: session.sessionId, participantToken: guest.participantToken },
    );
    await participant.goto(`/play/${session.sessionId}`);
    await expect(participant.locator(".live-shell")).toHaveAttribute("data-ux-beta", "false");
    await host.getByRole("button", { name: "Start round", exact: true }).click();
    await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "question_open");
    await expect(
      participant.getByRole("heading", { name: "What is two plus two?", exact: true }),
    ).toBeVisible();
    const confidenceToggle = host.getByRole("checkbox", {
      name: "Ask for confidence (optional)",
      exact: true,
    });
    await expect(confidenceToggle).toBeChecked();
    await expect(participant.getByTestId("optional-confidence")).toBeVisible();
    await expect(participant.getByTestId("optional-confidence").locator("legend")).toHaveText(
      "How sure are you? (Optional)",
    );

    const ownSnapshot = async () => {
      const response = await participant.request.get(
        `${apiUrl}/v1/sessions/${session.sessionId}/snapshot?role=participant`,
        { headers: { authorization: `Bearer ${guest.participantToken}` } },
      );
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()).snapshot as SessionSnapshot;
    };
    expect(await ownSnapshot()).toMatchObject({
      uxBeta: false,
      settings: { resultVisibility: "private", confidenceEnabled: true },
      question: { confidence: "optional" },
    });
    const correctChoice = participant.getByRole("button", { name: "Four", exact: true });
    await correctChoice.click();
    await expect(correctChoice).toHaveAttribute("aria-pressed", "true");
    await expect(participant.getByText("Answer received and saved.", { exact: true })).toHaveCount(
      0,
    );
    const submit = participant.getByRole("button", { name: "Submit response", exact: true });
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    await confidenceToggle.uncheck();
    await expect(confidenceToggle).not.toBeChecked();
    await expect(participant.getByTestId("optional-confidence")).toHaveCount(0);
    await expect(correctChoice).toHaveAttribute("aria-pressed", "true");
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      participant.getByText("Answer received and saved.", { exact: true }),
    ).toBeVisible();
    expect(await ownSnapshot()).toMatchObject({
      myResponse: { kind: "choice", choiceIds: [correctChoiceId] },
      myConfidence: null,
      settings: { confidenceEnabled: false },
    });
    await host.getByRole("button", { name: "Lock answers", exact: true }).click();
    await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "question_locked");
    await host.getByRole("button", { name: "Reveal answer", exact: true }).click();
    await expect(participant.getByText("Correct", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: "Finish round", exact: true }).click();
    await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "finished");
    const final = await ownSnapshot();
    expect(final.phase).toBe("finished");
    expect(final.myConfidence).toBeNull();
    const score = final.participants.find(({ id }) => id === guest.participantId)!.score;
    expect(score).toBeGreaterThan(0);
    await expect(
      participant.getByText(`Your final score is ${score.toLocaleString("en-CA")}.`, {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await participantContext.close();
  }
});

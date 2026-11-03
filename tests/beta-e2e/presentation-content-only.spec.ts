import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { ContentSlideDraft } from "../../packages/contracts/src/index.ts";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

function contentSlide(title: string, body: string, notes: string): ContentSlideDraft {
  return {
    id: randomUUID(),
    kind: "content",
    layout: "title_body",
    textElements: [
      {
        id: randomUUID(),
        role: "title",
        text: title,
        region: "top_center",
        order: 0,
        frame: { x: 8, y: 10, width: 84, height: 24 },
      },
      {
        id: randomUUID(),
        role: "body",
        text: body,
        region: "middle_center",
        order: 0,
        frame: { x: 8, y: 44, width: 84, height: 40 },
      },
    ],
    mediaId: null,
    mediaAlt: null,
    speakerNotes: notes,
  };
}

async function guestSnapshot(page: Page, sessionId: string, privateNotes: string[]) {
  const token = await page.evaluate(
    (id) => sessionStorage.getItem(`openround:presentation-participant:${id}`),
    sessionId,
  );
  expect(token).toBeTruthy();
  const response = await page.request.get(
    `${apiUrl}/v1/presentation-sessions/${sessionId}/participant`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  const { snapshot } = await response.json();
  const rendered = await page.content();
  for (const notes of privateNotes) {
    expect(JSON.stringify(snapshot)).not.toContain(notes);
    expect(rendered).not.toContain(notes);
  }
  if (snapshot.currentBlock) expect(snapshot.currentBlock).not.toHaveProperty("speakerNotes");
  expect(snapshot.standing).toBeNull();
  return snapshot;
}

for (const suffix of ["", " @mobile"]) {
  test(`content-only decks save, publish, present and report without quiz claims${suffix}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInBeta(page);
    const identifier = randomUUID().slice(0, 8);
    const title = `Content-only project update ${identifier}`;
    const firstTitle = "Updated project overview";
    const firstBody = "Review the open decisions and agree on the next step.";
    const secondTitle = "Next steps";
    const secondBody = "Name an owner for each agreed action before closing.";
    const privateNotes = [
      `Private opening note ${identifier}`,
      `Private closing note ${identifier}`,
    ];
    const created = await page.request.post(`${apiUrl}/v1/presentations`, {
      data: { title, description: "A synthetic two-slide project update without questions." },
    });
    expect(created.status()).toBe(201);
    const presentation = (await created.json()).presentation;
    const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
      data: {
        draft: {
          ...presentation.draft,
          blocks: [
            contentSlide("Project overview", "Initial discussion context.", privateNotes[0]!),
            contentSlide(secondTitle, secondBody, privateNotes[1]!),
          ],
        },
        expectedRevision: presentation.draftRevision,
        mutationId: randomUUID(),
        schemaVersion: 2,
      },
    });
    expect(saved.status()).toBe(200);

    // Exercise the real editor, autosave, and publication rather than a draft route stub.
    await page.goto(`/presentation/${presentation.id}`);
    const canvas = page.locator("#presentation-canvas");
    await canvas.getByLabel("Slide title", { exact: true }).fill(firstTitle);
    await canvas.getByLabel("Text box 1", { exact: true }).fill(firstBody);
    await expect
      .poll(async () => {
        const response = await page.request.get(`${apiUrl}/v1/presentations/${presentation.id}`);
        expect(response.status()).toBe(200);
        const draft = (await response.json()).presentation.draft;
        return {
          kinds: draft.blocks.map((block: { kind: string }) => block.kind),
          text: draft.blocks[0].textElements.map((element: { text: string }) => element.text),
          notes: draft.blocks.map((block: { speakerNotes: string }) => block.speakerNotes),
        };
      })
      .toEqual({
        kinds: ["content", "content"],
        text: [firstTitle, firstBody],
        notes: privateNotes,
      });
    await page.reload();
    await expect(canvas.getByLabel("Slide title", { exact: true })).toHaveValue(firstTitle);
    await expect(canvas.getByLabel("Text box 1", { exact: true })).toHaveValue(firstBody);

    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/presentations/${presentation.id}/publish`,
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await publishing).status()).toBe(200);

    const createdSession = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
      data: { presentationId: presentation.id },
    });
    expect(createdSession.status()).toBe(201);
    const { snapshot: lobby, controlToken } = await createdSession.json();
    const sessionId = lobby.sessionId as string;
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
      { id: sessionId, token: controlToken },
    );
    await page.goto(`/presentation-session/${sessionId}/host`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
    });
    const guest = await guestContext.newPage();
    try {
      await guest.goto(`/join?code=${lobby.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("Project attendee");
      const joining = guest.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/v1/presentation-sessions/join",
      );
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      expect((await joining).status()).toBe(201);
      await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
      await expect(guest.getByText("You’re in", { exact: true })).toBeVisible();
      await guestSnapshot(guest, sessionId, privateNotes);

      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expect(guest.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
      await expect(guest.getByText(firstBody, { exact: true })).toBeVisible();
      expect((await guestSnapshot(guest, sessionId, privateNotes)).currentBlock.kind).toBe(
        "content",
      );

      // Both surfaces recover from an actual reload with their existing credentials.
      await page.reload();
      await expect(page.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
      await guest.reload();
      await expect(guest.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
      expect((await guestSnapshot(guest, sessionId, privateNotes)).currentBlockIndex).toBe(0);

      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(guest.getByRole("heading", { name: secondTitle, exact: true })).toBeVisible();
      await expect(guest.getByText(secondBody, { exact: true })).toBeVisible();
      expect((await guestSnapshot(guest, sessionId, privateNotes)).currentBlockIndex).toBe(1);

      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Presentation finished" })).toBeVisible();
      await expect(page.getByText("1 joined", { exact: true })).toBeVisible();
      await expect(guest.getByRole("heading", { name: "Thanks for participating" })).toBeVisible();
      await expect(guest.getByText("Presentation finished", { exact: true })).toBeVisible();
      expect((await guestSnapshot(guest, sessionId, privateNotes)).phase).toBe("finished");
      expect(await guest.locator("body").innerText()).not.toMatch(/\b(?:rank|points)\b/i);
      await expect(guest.getByText(/Your responses have been saved/)).toHaveCount(0);
      await expect(page.getByText("These polls collect opinions", { exact: false })).toHaveCount(0);

      await page.getByRole("link", { name: "Open session report", exact: true }).click();
      await expect(page).toHaveURL(`/presentation-session/${sessionId}/report`);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: secondTitle, exact: true })).toBeVisible();
      await expect(
        page
          .getByText("Participants", { exact: true })
          .locator("..")
          .getByText("1", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByText("Total blocks", { exact: true })
          .locator("..")
          .getByText("2", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Facilitation timeline" })).toBeVisible();
      await expect(page.getByText("content presented", { exact: true })).toHaveCount(2);
      await expect(page.getByText("presentation finished", { exact: true })).toBeVisible();
      for (const label of ["Leaderboard", "Responses", "Accuracy", "Not assessed."]) {
        await expect(page.getByText(label, { exact: true })).toHaveCount(0);
      }
      await expect(page.getByText(/0 points/)).toHaveCount(0);
      for (const notes of privateNotes) expect(await page.content()).not.toContain(notes);
    } finally {
      await guestContext.close();
    }
  });
}

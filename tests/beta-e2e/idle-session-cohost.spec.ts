import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import { joinBetaParticipant } from "./round-join";
import { signInBeta } from "./sign-in";

const api = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;
test.use({ actionTimeout: 15_000 });

async function scopedRoom(page: Page) {
  await signInBeta(page);
  const created = await page.request.post(`${api}/v1/quizzes`, {
    data: { title: "Independent cohost capability" },
  });
  expect(created.status()).toBe(201);
  const quizId = (await created.json()).quiz.id as string;
  const saved = await page.request.patch(`${api}/v1/quizzes/${quizId}`, {
    data: {
      title: "Independent cohost capability",
      description: "Synthetic scope and creator-session separation.",
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          purpose: "diagnostic",
          confidence: "off",
          prompt: "Which credential authorizes this room?",
          choices: [
            { id: randomUUID(), label: "The scoped cohost grant", isCorrect: true },
            { id: randomUUID(), label: "An unrelated workspace cookie", isCorrect: false },
          ],
          timeLimitSeconds: 300,
          basePoints: 1000,
          explanation: "Room grants and creator sessions have separate authority.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    },
  });
  expect(saved.status()).toBe(200);
  expect(
    (await page.request.post(`${api}/v1/quizzes/${quizId}/publish`, { data: {} })).status(),
  ).toBe(200);
  const hosted = await page.request.post(`${api}/v1/sessions`, {
    data: {
      quizId,
      clientCapabilities: currentRoundClientCapabilities(),
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    },
  });
  expect(hosted.status()).toBe(201);
  const room = (await hosted.json()) as { sessionId: string; code: string; hostToken: string };
  const granted = await page.request.post(`${api}/v1/sessions/${room.sessionId}/staff`, {
    data: { role: "cohost", label: "Scoped assistant", expiresInMinutes: 240 },
  });
  expect(granted.status()).toBe(201);
  const grant = (await granted.json()) as { token: string; credential: { id: string } };
  await page.evaluate(
    ({ sessionId, hostToken }) => sessionStorage.setItem(`openround:host:${sessionId}`, hostToken),
    room,
  );
  await page.goto(`/host/${room.sessionId}`);
  await expect(page.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
  return { ...room, grant };
}

for (const suffix of ["desktop", "@mobile"]) {
  test(`scoped cohost joins and reloads independently while creator access remains gated ${suffix}`, async ({
    page: owner,
    browser,
  }, info) => {
    test.setTimeout(90_000);
    const viewport =
      suffix === "@mobile" ? { width: 320, height: 740 } : { width: 1280, height: 800 };
    await owner.setViewportSize(viewport);
    const room = await scopedRoom(owner);
    const hostPath = `/host/${room.sessionId}`;
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    await context.addInitScript(
      ({ id, token }) => {
        // Upgrading tabs can still have this shared credential in the old owner
        // key. Only the explicit cohost fragment identifies it for migration.
        if (
          location.pathname === `/host/${id}` &&
          new URLSearchParams(location.hash.slice(1)).has("cohost")
        )
          sessionStorage.setItem(`openround:host:${id}`, token);
      },
      { id: room.sessionId, token: room.grant.token },
    );
    await context.addCookies([
      { name: "openround-locale", value: "en-CA", url: new URL(owner.url()).origin },
    ]);
    const cohost = await context.newPage();
    let idleReads = 0;
    cohost.on("request", (request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/v1/auth/session")
        idleReads += 1;
    });
    try {
      expect((await context.cookies()).some((cookie) => cookie.name === "openround_creator")).toBe(
        false,
      );
      const link = new URL(hostPath, owner.url());
      link.hash = new URLSearchParams({ cohost: room.grant.token }).toString();
      await cohost.goto(link.toString());
      await expect(cohost.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
      await expect(cohost).toHaveURL(
        (url) => url.pathname === hostPath && !url.hash && !url.search,
      );
      expect(
        await cohost.evaluate(
          ({ id, token }) => ({
            cohostMatches: sessionStorage.getItem(`openround:cohost:${id}`) === token,
            legacyRemoved: sessionStorage.getItem(`openround:host:${id}`) === null,
          }),
          { id: room.sessionId, token: room.grant.token },
        ),
      ).toEqual({ cohostMatches: true, legacyRemoved: true });
      await expect(cohost.locator("details.staff-management")).toHaveCount(0);
      await cohost.reload();
      await expect(cohost.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
      expect(idleReads).toBe(0);

      // Only creator verification is controlled here. Backend clock tests cover
      // actual row expiry; this denial proves the owner root-host pass cannot
      // bypass the global gate while a separately granted cohost remains usable.
      await owner.route(`${api}/v1/auth/session`, (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              status: 401,
              headers: {
                "access-control-allow-origin": new URL(owner.url()).origin,
                "access-control-allow-credentials": "true",
              },
              json: { error: { code: "SESSION_EXPIRED", message: "Creator session expired." } },
            })
          : route.continue(),
      );
      await owner.evaluate(() => window.dispatchEvent(new Event("pollingpops:session-expired")));
      await expect(owner).toHaveURL(
        (url) => url.pathname === "/signin" && url.searchParams.get("returnTo") === hostPath,
      );
      await expect(owner.getByTestId("host-session")).toHaveCount(0);
      await owner.goto(hostPath);
      await expect(owner).toHaveURL(
        (url) => url.pathname === "/signin" && url.searchParams.get("returnTo") === hostPath,
      );
      await expect(owner.getByTestId("host-session")).toHaveCount(0);

      const joined = await joinBetaParticipant(cohost.request, api, {
        code: room.code,
        nickname: "Scoped room learner",
        avatarId: "comet",
        clientCapabilities: currentRoundClientCapabilities(),
      });
      expect(joined.status()).toBe(201);
      const start = cohost.getByRole("button", { name: "Start round", exact: true });
      await expect(start).toBeVisible();
      await expect(start).toBeEnabled();
      await start.click();
      await expect(cohost.getByTestId("host-session")).toHaveAttribute(
        "data-phase",
        "question_open",
      );
      const started = await cohost.request.get(`${api}/v1/sessions/${room.sessionId}/snapshot`, {
        params: {
          role: "host",
          clientCapabilities: JSON.stringify(currentRoundClientCapabilities()),
        },
        headers: { authorization: `Bearer ${room.grant.token}` },
      });
      expect(started.status()).toBe(200);
      expect((await started.json()).snapshot.phase).toBe("question_open");
      await cohost.reload();
      await expect(cohost.getByTestId("host-session")).toHaveAttribute(
        "data-phase",
        "question_open",
      );
      expect(idleReads).toBe(0);
      await cohost.screenshot({
        path: info.outputPath("cohost-after-creator-expiry.png"),
        fullPage: true,
      });

      await cohost.goto("/dashboard");
      await expect(cohost).toHaveURL(
        (url) => url.pathname === "/signin" && url.searchParams.get("returnTo") === "/dashboard",
      );
      await expect(cohost.getByLabel("Checkpoint set title", { exact: true })).toHaveCount(0);
      const unrelatedHost = `/host/${randomUUID()}`;
      await cohost.goto(unrelatedHost);
      await expect(cohost).toHaveURL(
        (url) => url.pathname === "/signin" && url.searchParams.get("returnTo") === unrelatedHost,
      );
      const privateReads = idleReads;
      expect(privateReads).toBeGreaterThan(0);
      await cohost.goto(hostPath);
      await expect(cohost.getByTestId("host-session")).toHaveAttribute(
        "data-phase",
        "question_open",
      );
      expect(idleReads).toBe(privateReads);

      expect(
        (
          await owner.request.delete(
            `${api}/v1/sessions/${room.sessionId}/staff/${room.grant.credential.id}`,
          )
        ).status(),
      ).toBe(204);
      const deniedSnapshot = await cohost.request.get(
        `${api}/v1/sessions/${room.sessionId}/snapshot`,
        {
          params: {
            role: "host",
            clientCapabilities: JSON.stringify(currentRoundClientCapabilities()),
          },
          headers: { authorization: `Bearer ${room.grant.token}` },
        },
      );
      expect([401, 403, 404]).toContain(deniedSnapshot.status());
      await cohost.reload();
      // Initial page sync uses a Socket.IO acknowledgement, not this HTTP read.
      // Wait for its resolved rejection rather than an empty loading-stage view.
      await expect(cohost.locator('main > p.error[role="alert"]')).toBeVisible();
      await expect(cohost.locator('main > p.error[role="alert"]')).not.toHaveText("");
      await expect(cohost.getByTestId("host-session")).toHaveCount(0);
      expect((await context.cookies()).some((cookie) => cookie.name === "openround_creator")).toBe(
        false,
      );
    } finally {
      await context.close();
    }
  });
}

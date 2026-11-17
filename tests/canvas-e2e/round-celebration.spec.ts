import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { HostAction, SessionSnapshot } from "@openround/contracts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import { api, fits, organization, web } from "./support";

type Room = { sessionId: string; code: string; hostToken: string };
type Guest = { participantToken: string };
const racers = ["Racer One", "Racer Two", "Racer Three", "Racer Four", "Racer Five", "Racer Six"];
const points = [3_000, 2_000, 1_000];
const capabilities = currentRoundClientCapabilities();
const dashboard = (page: Page) => page.getByTestId("competition-dashboard");

function question(index: number) {
  return {
    id: randomUUID(),
    type: "single_select" as const,
    prompt: `Scored celebration checkpoint ${index + 1}`,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    choices: [
      { id: randomUUID(), label: "Check the conditions", isCorrect: true },
      { id: randomUUID(), label: "Skip the review", isCorrect: false },
    ],
    timeLimitSeconds: 300,
    basePoints: 1_000,
    explanation: "Check the conditions before proceeding.",
    mediaId: null,
    mediaAlt: null,
  };
}

async function snapshot(host: Page, room: Room): Promise<SessionSnapshot> {
  const query = new URLSearchParams({
    role: "host",
    clientCapabilities: JSON.stringify(capabilities),
  });
  const response = await host.request.get(
    `${api}/v1/sessions/${room.sessionId}/snapshot?${query}`,
    { headers: { authorization: `Bearer ${room.hostToken}` } },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).snapshot;
}

async function command(host: Page, room: Room, action: HostAction) {
  const current = await snapshot(host, room);
  const response = await host.request.post(`${api}/v1/sessions/${room.sessionId}/commands`, {
    headers: { authorization: `Bearer ${room.hostToken}` },
    data: {
      action,
      commandId: randomUUID(),
      expectedVersion: current.version,
      clientCapabilities: capabilities,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).snapshot as SessionSnapshot;
}

async function createRound(host: Page, dark: boolean) {
  const questions = [0, 1, 2].map(question);
  const made = await host.request.post(`${api}/v1/quizzes`, {
    data: { title: "Round celebration browser check", description: "" },
  });
  expect(made.status()).toBe(201);
  const { quiz } = await made.json();
  const changed = await host.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
    data: {
      draft: {
        ...quiz.draft,
        category: "icebreaker",
        experiencePreset: { id: dark ? "observatory" : "signal", version: 1 },
        questions,
      },
      expectedDraftRevision: quiz.draftRevision,
    },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  const saved = (await changed.json()).quiz;
  const published = await host.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: saved.draftRevision },
  });
  expect(published.status()).toBe(200);
  const hosted = await host.request.post(`${api}/v1/sessions`, {
    data: {
      quizId: quiz.id,
      clientCapabilities: capabilities,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "leaderboard",
        allowLateJoin: true,
        nicknamePolicy: "custom",
        confidenceEnabled: false,
      },
    },
  });
  expect(hosted.status(), await hosted.text()).toBe(201);
  const room = (await hosted.json()) as Room;
  const guests: Guest[] = [];
  for (const nickname of racers) {
    const joined = await host.request.post(`${api}/v1/sessions/join`, {
      data: { code: room.code, nickname, clientCapabilities: capabilities },
    });
    expect(joined.status(), await joined.text()).toBe(201);
    guests.push((await joined.json()) as Guest);
  }
  await host.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, room);
  await host.goto(`/host/${room.sessionId}`);
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
  return { room, guests, questions };
}

async function runningAnimations(element: Locator) {
  return element.evaluateAll(
    (nodes) =>
      nodes
        .flatMap((node) => node.getAnimations({ subtree: true }))
        .filter((animation) => {
          const duration = animation.effect?.getComputedTiming().duration;
          return animation.playState === "running" && typeof duration === "number" && duration > 1;
        }).length,
  );
}

async function expectStill(root: Locator) {
  await expect(root).not.toHaveAttribute("data-celebrating", "true");
  for (const testId of ["competition-celebration", "competition-race"]) {
    await expect.poll(() => runningAnimations(root.getByTestId(testId))).toBe(0);
  }
}

async function expectScores(root: Locator) {
  const podium = root.getByTestId("competition-podium");
  await expect(podium).toBeVisible();
  const race = root.getByTestId("competition-race");
  await expect(race).toBeVisible();
  for (const [index, score] of points.entries()) {
    const place = podium.locator(`[data-rank="${index + 1}"]`);
    await expect(place).toContainText(racers[index]!);
    await expect(place).toContainText(score.toLocaleString("en-CA"));
    const row = race.locator(`li[data-rank="${index + 1}"]`);
    await expect(row).toContainText(racers[index]!);
    await expect(row).toContainText(score.toLocaleString("en-CA"));
    const fill = row.getByTestId("competition-race-fill");
    await expect(fill).toHaveAttribute("data-score", String(score));
    expect(await fill.evaluate((element) => Number.parseFloat(element.style.width))).toBeCloseTo(
      (score / points[0]!) * 100,
      4,
    );
  }
}

async function expectRunnersClearOfStandings(root: Locator, width: number) {
  const race = root.getByTestId("competition-race");
  const rows = race.locator(":scope > li");
  await expect(rows).toHaveCount(5);
  expect(await race.locator('[data-score="0"]').count()).toBeGreaterThan(0);
  const variant = await root.getAttribute("data-variant");
  for (const row of await rows.all()) {
    const textRow = row.locator(":scope > div").first();
    const runner = row.getByTestId("competition-race-fill").locator(":scope > span");
    await expect(runner).toBeVisible();
    const textBounds = await textRow.boundingBox();
    const runnerBounds = await runner.boundingBox();
    expect(textBounds).not.toBeNull();
    expect(runnerBounds).not.toBeNull();
    expect(
      runnerBounds!.y,
      `${variant} finale at ${width}px: runner clears ${await textRow.innerText()}`,
    ).toBeGreaterThan(textBounds!.y + textBounds!.height);
  }
}

async function openOptions(root: Locator) {
  const options = root.getByTestId("competition-display-options");
  if ((await options.getAttribute("open")) === null) await options.locator("summary").click();
}

async function showFinale(root: Locator) {
  await root.getByTestId("competition-stage").scrollIntoViewIfNeeded();
}

for (const suffix of ["", " @mobile"]) {
  test(`Round finale waits to be seen, replays real race motion, and respects saved accessibility${suffix}`, async ({
    page: host,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    if (!suffix) await host.setViewportSize({ width: 1600, height: 1000 });
    await host.emulateMedia({ reducedMotion: "no-preference" });
    await organization(host, info);
    const { room, guests, questions } = await createRound(host, Boolean(suffix));
    const context = await browser.newContext({
      baseURL: web,
      viewport: suffix ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      reducedMotion: "no-preference",
      colorScheme: "light",
    });
    try {
      const participant = await context.newPage();
      await participant.addInitScript(
        ({ sessionId, participantToken }) =>
          sessionStorage.setItem(`openround:participant:${sessionId}`, participantToken),
        { sessionId: room.sessionId, participantToken: guests[0]!.participantToken },
      );
      await participant.goto(`/play/${room.sessionId}`);
      await expect(participant.locator(".live-shell")).toBeVisible();
      const issued = await host.request.post(`${api}/v1/sessions/${room.sessionId}/staff`, {
        data: { role: "presenter", label: "Celebration test display" },
      });
      expect(issued.status()).toBe(201);
      const { token } = await issued.json();
      const presenter = await context.newPage();
      if (!suffix) await presenter.setViewportSize({ width: 1600, height: 1000 });
      await presenter.addInitScript(
        ({ sessionId, presenterToken }) =>
          sessionStorage.setItem(`openround:presenter:${sessionId}`, presenterToken),
        { sessionId: room.sessionId, presenterToken: token },
      );
      const unrelatedSnapshots = new Set<number>();
      presenter.on("websocket", (socket) => {
        const url = new URL(socket.url());
        if (url.host !== new URL(api).host || url.pathname !== "/socket.io/") return;
        // Development HMR and StrictMode's abandoned first connection are not the live session.
        socket.on("framereceived", ({ payload }) => {
          const packet = String(payload);
          if (!packet.startsWith("42")) return;
          // Server events request receipts, so Socket.IO inserts an acknowledgement id before '['.
          const start = packet.indexOf("[");
          if (start < 0) return;
          const [event, envelope] = JSON.parse(packet.slice(start)) as [
            string,
            { payload?: { snapshot?: Pick<SessionSnapshot, "sessionId" | "version"> } },
          ];
          const received = envelope?.payload?.snapshot;
          if (event === "lobby.updated" && received?.sessionId === room.sessionId)
            unrelatedSnapshots.add(received.version);
        });
      });
      await presenter.goto(`/present/${room.sessionId}`);
      await expect(presenter.locator(".live-shell")).toBeVisible();

      await command(host, room, "start");
      for (const [index, currentQuestion] of questions.entries()) {
        const current = await snapshot(host, room);
        expect(current.phase).toBe("question_open");
        for (const [guestIndex, guest] of guests.entries()) {
          const answer = await host.request.post(`${api}/v1/sessions/${room.sessionId}/answers`, {
            headers: { authorization: `Bearer ${guest.participantToken}` },
            data: {
              roundId: current.roundId,
              choiceId: currentQuestion.choices[guestIndex <= 2 - index ? 0 : 1]!.id,
              idempotencyKey: randomUUID(),
              clientCapabilities: capabilities,
            },
          });
          expect(answer.ok(), await answer.text()).toBe(true);
          expect(await answer.json()).toMatchObject({ accepted: true });
        }
        await command(host, room, "lock");
        await command(host, room, "reveal");
        if (index < questions.length - 1) await command(host, room, "next");
      }
      for (const audience of [host, presenter, participant]) {
        await expect(dashboard(audience)).toHaveAttribute("data-status", "live");
        await expect(dashboard(audience)).toHaveAttribute("data-celebration-run", "0");
        await expect(dashboard(audience)).not.toHaveAttribute("data-celebrating", "true");
      }

      // Keep Q&A selected through the finish; final standings must move onto the primary stage.
      await participant.getByRole("tab", { name: "Q&A", exact: true }).click();
      // Keep the final podium offscreen until its visibility behavior is checked below.
      await participant.setViewportSize({ width: suffix ? 390 : 1280, height: 200 });
      await participant.evaluate(() => window.scrollTo(0, 0));
      await host.setViewportSize({ width: 1280, height: 200 });
      await host.evaluate(() => window.scrollTo(0, 0));
      expect((await command(host, room, "next")).phase).toBe("finished");
      await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "finished");
      await expect(dashboard(host)).not.toBeInViewport();
      await expect(dashboard(participant)).toBeVisible();
      await expect(
        participant.getByTestId("participant-final-results").getByTestId("competition-dashboard"),
      ).toBeVisible();
      await expect(dashboard(participant).getByTestId("competition-stage")).not.toBeInViewport();
      await expect(participant.getByRole("tab", { name: "Standings", exact: true })).toHaveCount(0);
      await expect(participant.getByRole("tab", { name: "Q&A", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(participant.getByTestId("scored-response-receipt")).toHaveCount(1);
      const hostAllStandings = dashboard(host)
        .locator("details")
        .filter({
          has: host.locator("summary").filter({ hasText: /^All standings/ }),
        });
      const hostStandingsState = !suffix
        ? await hostAllStandings.evaluate((element) => {
            const disclosure = element as HTMLDetailsElement;
            const state = { open: disclosure.open, minHeight: disclosure.style.minHeight };
            // A large expanded audience must not make the visibility target unreachable.
            disclosure.open = true;
            disclosure.style.minHeight = "12000px";
            return state;
          })
        : null;

      await presenter.bringToFront();
      await expect(dashboard(presenter)).toHaveAttribute("data-status", "final");
      await showFinale(dashboard(presenter));
      await expect(dashboard(presenter)).toHaveAttribute("data-celebration-run", "1");
      // Waiting for the bounded playback to end also proves offscreen finales were deferred.
      await expect(dashboard(presenter)).not.toHaveAttribute("data-celebrating", "true", {
        timeout: 7_000,
      });
      for (const audience of [host, participant]) {
        await expect(dashboard(audience)).toHaveAttribute("data-celebration-run", "0");
      }

      for (const action of ["lock_lobby", "unlock_lobby"] as const) {
        const updated = await command(host, room, action);
        await expect.poll(() => unrelatedSnapshots.has(updated.version)).toBe(true);
        await presenter.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await expect(dashboard(presenter)).toHaveAttribute("data-celebration-run", "1");
        await expectStill(dashboard(presenter));
      }
      await dashboard(presenter).getByTestId("competition-replay").click();
      await expect(dashboard(presenter)).toHaveAttribute("data-celebration-run", "2");
      await expect(dashboard(presenter)).toHaveAttribute("data-celebrating", "true");
      // Sample visible playback rather than disabling animations for the capture.
      await presenter.waitForTimeout(1_000);
      const replayImage = info.outputPath("finale-replay-motion-on.png");
      await presenter.screenshot({ path: replayImage, animations: "allow" });
      await info.attach("Finale replay with motion on", {
        path: replayImage,
        contentType: "image/png",
      });
      await expect(dashboard(presenter)).not.toHaveAttribute("data-celebrating", "true", {
        timeout: 7_000,
      });
      if (hostStandingsState) {
        await host.setViewportSize({ width: 1600, height: 600 });
        const hostStage = dashboard(host).getByTestId("competition-stage");
        await hostStage.evaluate((element) => {
          window.scrollTo({
            top: window.scrollY + element.getBoundingClientRect().top - window.innerHeight + 1,
            behavior: "instant",
          });
        });
        await host.bringToFront();
        await host.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const barelyVisibleStage = await hostStage.boundingBox();
        expect(barelyVisibleStage).not.toBeNull();
        expect(barelyVisibleStage!.y).toBeGreaterThanOrEqual(598);
        expect(barelyVisibleStage!.y).toBeLessThan(600);
        await expect(dashboard(host)).toHaveAttribute("data-celebration-run", "0");

        await host.evaluate(() => window.scrollBy({ top: 100, behavior: "instant" }));
        const visibleStage = await hostStage.boundingBox();
        expect(visibleStage).not.toBeNull();
        expect(600 - visibleStage!.y).toBeGreaterThanOrEqual(100);
        expect((600 - visibleStage!.y) / visibleStage!.height).toBeLessThan(0.1);
        await expect(dashboard(host)).toHaveAttribute("data-celebration-run", "1");
        await hostAllStandings.evaluate((element, state) => {
          const disclosure = element as HTMLDetailsElement;
          disclosure.open = state.open;
          disclosure.style.minHeight = state.minHeight;
        }, hostStandingsState);
      } else {
        await host.setViewportSize({ width: 1600, height: 1000 });
        await host.bringToFront();
        await showFinale(dashboard(host));
        await expect(dashboard(host)).toHaveAttribute("data-celebration-run", "1");
      }
      await participant.setViewportSize({ width: suffix ? 390 : 1280, height: suffix ? 844 : 900 });
      await participant.bringToFront();
      const root = dashboard(participant);
      await showFinale(root);
      await expect(root).toHaveAttribute("data-status", "final");
      await expect(root).toHaveAttribute("data-celebration-run", "1");
      await expectScores(root);
      const options = root.getByTestId("competition-display-options");
      await expect(options).not.toHaveAttribute("open", "");
      const replay = root.getByTestId("competition-replay");
      await expect(replay).toBeVisible();
      expect(await replay.evaluate((button) => button.closest("details") === null)).toBe(true);
      const allStandings = root.locator("details").filter({
        has: participant.locator("summary").filter({ hasText: /^All standings/ }),
      });
      await allStandings.locator("summary").click();
      const tableView = root.getByRole("button", { name: "Table view", exact: true });
      await tableView.focus();
      await expect(tableView).toBeFocused();
      const scoreboardControl = await tableView.elementHandle();
      expect(scoreboardControl).not.toBeNull();
      await replay.focus();
      await replay.press("Enter");
      await expect(root).toHaveAttribute("data-celebration-run", "2");
      await expect(root).toHaveAttribute("data-celebrating", "true");
      await expect(replay).toBeFocused();
      expect(await scoreboardControl!.evaluate((button) => button.isConnected)).toBe(true);
      await expect(allStandings).toHaveAttribute("open", "");
      for (const testId of ["competition-celebration", "competition-race"]) {
        await expect.poll(() => runningAnimations(root.getByTestId(testId))).toBeGreaterThan(0);
      }

      const beforeQna = await root.getAttribute("data-celebration-run");
      const qnaTab = participant.getByRole("tab", { name: "Q&A", exact: true });
      // Keyboard interaction with the side tool must not hide or remount a playing finale.
      // Keep the viewport still here so mobile scrolling does not interrupt playback.
      await qnaTab.evaluate((button) =>
        (button as HTMLButtonElement).focus({ preventScroll: true }),
      );
      await qnaTab.press("Enter");
      await expect(root).toBeVisible();
      await expect(root).toHaveAttribute("data-celebration-run", beforeQna!);
      await expect(qnaTab).toHaveAttribute("aria-selected", "true");
      await expect(root).not.toHaveAttribute("data-celebrating", "true", { timeout: 7_000 });
      // Visiting Q&A after playback also keeps completed results and their controls intact.
      await qnaTab.click();
      await expect(root).toBeVisible();
      await showFinale(root);
      await expect(root).toHaveAttribute("data-celebration-run", beforeQna!);
      await expectStill(root);
      expect(await scoreboardControl!.evaluate((button) => button.isConnected)).toBe(true);
      await expect(allStandings).toHaveAttribute("open", "");
      await allStandings.locator("summary").click();
      await tableView.click();
      for (const [index, score] of points.entries()) {
        const row = root.getByRole("row").filter({ hasText: racers[index]! });
        await expect(row).toContainText(score.toLocaleString("en-CA"));
      }
      await root.getByRole("button", { name: "Race view", exact: true }).click();
      await expectScores(root);

      await openOptions(root);
      await root.getByTestId("competition-motion-toggle").click();
      await expect(root.getByTestId("competition-motion-toggle")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(replay).toBeDisabled();
      await expectStill(root);
      await participant.reload();
      await expect(root).toHaveAttribute("data-celebration-run", "0");
      await expect(replay).toBeDisabled();
      await expectStill(root);
      await openOptions(root);
      await root.getByTestId("competition-motion-toggle").click();
      await expect(replay).toBeEnabled();
      await participant.emulateMedia({ reducedMotion: "reduce" });
      await expect(root.getByTestId("competition-motion-toggle")).toBeDisabled();
      await expect(replay).toBeDisabled();
      await expectStill(root);
      await participant.emulateMedia({ reducedMotion: "no-preference" });
      const preferences = participant.locator("details.experience-preferences");
      await preferences.locator("summary").click();
      await preferences.getByRole("checkbox", { name: "Reduce motion", exact: true }).check();
      await expect(replay).toBeDisabled();
      await expectStill(root);
      await participant.reload();
      await expect(participant.locator("html")).toHaveAttribute("data-openround-motion", "reduced");
      await expect(replay).toBeDisabled();
      await expectStill(root);

      for (const width of suffix ? [390, 320] : [1280]) {
        await participant.setViewportSize({ width, height: 844 });
        for (const mode of ["light", "dark"] as const) {
          await participant.emulateMedia({ colorScheme: mode });
          await participant.evaluate((colorMode) => {
            localStorage.setItem("openround:color-mode", colorMode);
            window.dispatchEvent(new Event("openround:color-mode-change"));
          }, mode);
          await expect(participant.locator("html")).toHaveAttribute("data-color-mode", mode);
          await showFinale(root);
          await fits(participant);
          expect(await root.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
            true,
          );
          const result = await new AxeBuilder({ page: participant })
            .include('[data-testid="competition-dashboard"]')
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          expect(result.violations, `Final standings at ${width}px in ${mode}`).toEqual([]);
          if (mode === "dark" && width === (suffix ? 320 : 1280)) {
            const finalImage = info.outputPath(`finale-static-dark-${width}.png`);
            await participant.screenshot({ path: finalImage, fullPage: true });
            await info.attach(`Static final standings in dark at ${width}px`, {
              path: finalImage,
              contentType: "image/png",
            });
          }
        }
      }

      if (!suffix) {
        // Desktop compact layouts must leave room for every final runner, including zero scores.
        for (const audience of [host, presenter]) {
          await audience.emulateMedia({ reducedMotion: "reduce" });
          await audience.bringToFront();
          const final = dashboard(audience);
          await expectStill(final);
          for (const width of [900, 1280, 1600]) {
            await audience.setViewportSize({ width, height: 1000 });
            await showFinale(final);
            await expectRunnersClearOfStandings(final, width);
          }
        }
      }
    } finally {
      await context.close();
    }
  });
}

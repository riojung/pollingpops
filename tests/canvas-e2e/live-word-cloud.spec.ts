import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { HostAction, SessionSnapshot } from "@openround/contracts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { currentRoundClientCapabilities } from "../../packages/contracts/src/round-protocol";
import { api, fits, organization, web } from "./support";

type Room = { sessionId: string; code: string; hostToken: string; snapshot: SessionSnapshot };
type Guest = { participantToken: string };
const capabilities = currentRoundClientCapabilities();
const phrase = "better team communication";
const cloud = (page: Page) => page.getByTestId("live-word-cloud-results");
const term = (page: Page, value: string) =>
  cloud(page).locator(`[data-term=${JSON.stringify(value)}]`);

async function snapshot(host: Page, room: Room): Promise<SessionSnapshot> {
  const query = new URLSearchParams({
    role: "host",
    clientCapabilities: JSON.stringify(capabilities),
  });
  const response = await host.request.get(
    `${api}/v1/sessions/${room.sessionId}/snapshot?${query}`,
    {
      headers: { authorization: `Bearer ${room.hostToken}` },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).snapshot;
}

async function command(
  host: Page,
  room: Room,
  action: HostAction,
  extra: { answerId?: string; responseStatus?: "approved" | "removed" } = {},
) {
  const current = await snapshot(host, room);
  const response = await host.request.post(`${api}/v1/sessions/${room.sessionId}/commands`, {
    headers: { authorization: `Bearer ${room.hostToken}` },
    data: {
      action,
      ...extra,
      commandId: randomUUID(),
      expectedVersion: current.version,
      clientCapabilities: capabilities,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).snapshot as SessionSnapshot;
}

async function createRound(host: Page, mode: "live" | "moderated") {
  const made = await host.request.post(`${api}/v1/quizzes`, {
    data: { title: "Live phrase cloud browser check", description: "" },
  });
  expect(made.status()).toBe(201);
  const { quiz } = await made.json();
  const changed = await host.request.patch(`${api}/v1/quizzes/${quiz.id}`, {
    data: {
      expectedDraftRevision: quiz.draftRevision,
      draft: {
        ...quiz.draft,
        category: "science",
        experiencePreset: { id: "observatory", version: 1 },
        questions: [
          {
            id: randomUUID(),
            type: "word_cloud",
            prompt: "What helps a team learn together?",
            purpose: "opinion",
            confidence: "off",
            delivery: "main",
            conceptKeys: [],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 300,
            basePoints: 0,
            explanation: "Discuss the phrases together.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
    },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  const saved = (await changed.json()).quiz;
  const published = await host.request.post(`${api}/v1/quizzes/${quiz.id}/publish`, {
    data: { expectedDraftRevision: saved.draftRevision },
  });
  expect(published.status(), await published.text()).toBe(200);
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
        // Exercise the capable-client default and the explicit legacy policy separately.
        ...(mode === "moderated" ? { wordCloudMode: "moderated" } : {}),
      },
    },
  });
  expect(hosted.status(), await hosted.text()).toBe(201);
  const room = (await hosted.json()) as Room;
  expect(room.snapshot.settings.wordCloudMode).toBe(mode);
  expect(room.snapshot.experienceTheme?.preset.id).toBe("observatory");
  const guests: Guest[] = [];
  for (let index = 0; index < (mode === "live" ? 5 : 1); index++) {
    const joined = await host.request.post(`${api}/v1/sessions/join`, {
      data: {
        code: room.code,
        nickname: `Cloud guest ${index + 1}`,
        clientCapabilities: capabilities,
      },
    });
    expect(joined.status(), await joined.text()).toBe(201);
    guests.push((await joined.json()) as Guest);
  }
  await host.evaluate(({ sessionId, hostToken }) => {
    sessionStorage.setItem(`openround:host:${sessionId}`, hostToken);
  }, room);
  await host.goto(`/host/${room.sessionId}`);
  await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "lobby");
  return { room, guests };
}

async function joinViewer(page: Page, room: Room, guest: Guest) {
  await page.addInitScript(
    ({ sessionId, participantToken }) =>
      sessionStorage.setItem(`openround:participant:${sessionId}`, participantToken),
    { sessionId: room.sessionId, participantToken: guest.participantToken },
  );
  await page.goto(`/play/${room.sessionId}`);
  await expect(page.locator(".live-shell")).toBeVisible();
}

async function submit(host: Page, room: Room, guest: Guest, roundId: string, value: string) {
  const response = await host.request.post(`${api}/v1/sessions/${room.sessionId}/answers`, {
    headers: { authorization: `Bearer ${guest.participantToken}` },
    data: {
      roundId,
      response: { kind: "text", value },
      idempotencyKey: randomUUID(),
      clientCapabilities: capabilities,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const result = (await response.json()) as { accepted: boolean; answerId: string };
  expect(result.accepted).toBe(true);
  expect(result.answerId).toBeTruthy();
  return result;
}

async function openCounts(page: Page) {
  const details = cloud(page).locator("details");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await expect(details.locator("summary")).toHaveText("View exact counts");
  return details;
}

async function expectCount(page: Page, value: string, count: number) {
  await page.bringToFront();
  await expect(term(page, value)).toHaveAttribute("data-count", String(count));
  const details = await openCounts(page);
  const row = details.getByRole("rowheader", { name: value, exact: true }).locator("..");
  await expect(row.getByRole("cell")).toHaveText(String(count));
}

async function runningAnimations(root: Locator) {
  return root.evaluateAll(
    (nodes) =>
      nodes
        .flatMap((node) => node.getAnimations({ subtree: true }))
        .filter((animation) => {
          const duration = animation.effect?.getComputedTiming().duration;
          return animation.playState === "running" && typeof duration === "number" && duration > 1;
        }).length,
  );
}

function observeEntrance(page: Page, value: string) {
  return cloud(page).evaluate(
    (element, expected) =>
      new Promise<{ duration: number; iterations: number } | null>((resolve) => {
        const timer = window.setTimeout(() => {
          element.removeEventListener("animationstart", record);
          resolve(null);
        }, 8_000);
        function record(event: Event) {
          const target = event.target as Element;
          if (target.closest("[data-term]")?.getAttribute("data-term") !== expected) return;
          const animation = target.getAnimations().find((item) => item.playState === "running");
          const timing = animation?.effect?.getComputedTiming();
          if (!timing || typeof timing.duration !== "number") return;
          window.clearTimeout(timer);
          element.removeEventListener("animationstart", record);
          resolve({ duration: timing.duration, iterations: timing.iterations ?? 1 });
        }
        element.addEventListener("animationstart", record);
      }),
    value,
  );
}

async function expectMotionDisabled(page: Page, value: string) {
  await expect(term(page, value)).toHaveAttribute("data-count", "1");
  const styles = await term(page, value).evaluate((element) => ({
    transition: getComputedStyle(element).transitionProperty,
    animation: getComputedStyle(element.firstElementChild!).animationName,
  }));
  expect(styles).toEqual({ transition: "none", animation: "none" });
  expect(await runningAnimations(term(page, value))).toBe(0);
}

async function expectNoCloudCollisions(page: Page) {
  const visual = cloud(page).getByTestId("word-cloud-visual");
  await expect.poll(() => runningAnimations(visual)).toBe(0);
  const bounds = await visual.evaluate((element) => {
    const outer = element.getBoundingClientRect();
    return {
      outer: { left: outer.left, right: outer.right, top: outer.top, bottom: outer.bottom },
      words: Array.from(element.querySelectorAll("[data-term]"), (word) => {
        const box = word.getBoundingClientRect();
        return {
          value: word.getAttribute("data-term"),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      }),
    };
  });
  for (const [index, word] of bounds.words.entries()) {
    expect(word.left, word.value ?? "word").toBeGreaterThanOrEqual(bounds.outer.left - 1);
    expect(word.right, word.value ?? "word").toBeLessThanOrEqual(bounds.outer.right + 1);
    expect(word.top, word.value ?? "word").toBeGreaterThanOrEqual(bounds.outer.top - 1);
    expect(word.bottom, word.value ?? "word").toBeLessThanOrEqual(bounds.outer.bottom + 1);
    for (const other of bounds.words.slice(index + 1)) {
      expect(
        word.left < other.right &&
          word.right > other.left &&
          word.top < other.bottom &&
          word.bottom > other.top,
        `${word.value} overlaps ${other.value}`,
      ).toBe(false);
    }
  }
}

for (const suffix of ["", " @mobile"]) {
  test(`Round cloud grows live for every role, removes responses, and preserves moderated privacy${suffix}`, async ({
    page: host,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    if (!suffix) await host.setViewportSize({ width: 1600, height: 1000 });
    await host.emulateMedia({ reducedMotion: "no-preference" });
    await organization(host, info);
    const { room, guests } = await createRound(host, "live");
    const context = await browser.newContext({
      baseURL: web,
      viewport: suffix ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      reducedMotion: "no-preference",
      colorScheme: "light",
    });
    try {
      const participant = await context.newPage();
      await joinViewer(participant, room, guests[0]!);
      const issued = await host.request.post(`${api}/v1/sessions/${room.sessionId}/staff`, {
        data: { role: "presenter", label: "Cloud test display" },
      });
      expect(issued.status(), await issued.text()).toBe(201);
      const { token } = await issued.json();
      const presenter = await context.newPage();
      if (!suffix) await presenter.setViewportSize({ width: 1600, height: 1000 });
      await presenter.addInitScript(
        ({ sessionId, presenterToken }) =>
          sessionStorage.setItem(`openround:presenter:${sessionId}`, presenterToken),
        { sessionId: room.sessionId, presenterToken: token },
      );
      await presenter.goto(`/present/${room.sessionId}`);
      await expect(presenter.locator(".live-shell")).toBeVisible();
      const opened = await command(host, room, "start");
      expect(opened.phase).toBe("question_open");
      const roundId = opened.roundId!;
      const audiences = [host, presenter, participant];
      for (const audience of audiences) {
        await audience.bringToFront();
        await expect(cloud(audience)).toBeVisible();
        await expect(
          cloud(audience).getByText("Waiting for the first response", { exact: true }),
        ).toBeVisible();
        await expect(audience.locator(".live-shell")).toHaveCSS("color-scheme", "dark");
      }

      await participant.bringToFront();
      const first = await submit(host, room, guests[0]!, roundId, "‘Better   team communication!’");
      for (const audience of audiences) await expectCount(audience, phrase, 1);
      expect((await snapshot(host, room)).phase).toBe("question_open");
      await expect(
        participant.getByText("Response saved and added to the live cloud.", { exact: true }),
      ).toBeVisible();
      await participant.bringToFront();
      await expect.poll(() => runningAnimations(term(participant, phrase))).toBe(0);
      const retained = await term(participant, phrase).elementHandle();
      expect(retained).not.toBeNull();
      const initialSize = await term(participant, phrase).evaluate((word) =>
        Number.parseFloat(getComputedStyle(word).fontSize),
      );
      await submit(host, room, guests[1]!, roundId, "better team communication");
      await expect(term(participant, phrase)).toHaveAttribute("data-count", "2");
      await expect
        .poll(() =>
          term(participant, phrase).evaluate((word) =>
            Number.parseFloat(getComputedStyle(word).fontSize),
          ),
        )
        .toBeGreaterThan(initialSize);
      expect(await retained!.evaluate((word) => word.isConnected)).toBe(true);
      for (const audience of audiences) {
        await expectCount(audience, phrase, 2);
        await expect(cloud(audience).locator("[data-term]")).toHaveCount(1);
      }

      await participant.bringToFront();
      const entrance = observeEntrance(participant, "c++");
      await submit(host, room, guests[2]!, roundId, "C++");
      await expect(term(participant, "c++")).toHaveAttribute("data-count", "1");
      const motion = await entrance;
      expect(motion).not.toBeNull();
      expect(motion!.duration).toBeGreaterThan(1);
      expect(motion!.duration).toBeLessThanOrEqual(1_000);
      expect(motion!.iterations).toBe(1);
      await expect.poll(() => runningAnimations(term(participant, "c++"))).toBe(0);

      await participant.emulateMedia({ reducedMotion: "reduce" });
      await submit(host, room, guests[3]!, roundId, "C#!");
      await expectMotionDisabled(participant, "c#");
      await participant.emulateMedia({ reducedMotion: "no-preference" });
      const preferences = participant.locator("details.experience-preferences");
      await preferences.locator("summary").click();
      await preferences.getByRole("checkbox", { name: "Reduce motion", exact: true }).check();
      await preferences.locator("summary").click();
      await expect(participant.locator("html")).toHaveAttribute("data-openround-motion", "reduced");
      const longPhrase = "shared experiments and patient practice together";
      await submit(host, room, guests[4]!, roundId, longPhrase);
      await expectMotionDisabled(participant, longPhrase);
      for (const audience of audiences) {
        await expectCount(audience, phrase, 2);
        await expectCount(audience, "c++", 1);
        await expectCount(audience, "c#", 1);
        await expectCount(audience, longPhrase, 1);
        await expect(cloud(audience).getByTestId("word-cloud-response-count")).toHaveText(
          "5 responses",
        );
      }

      for (const width of suffix ? [390, 320] : [1280]) {
        await participant.setViewportSize({ width, height: 844 });
        await participant.bringToFront();
        await cloud(participant).scrollIntoViewIfNeeded();
        await fits(participant);
        await expectNoCloudCollisions(participant);
        const result = await new AxeBuilder({ page: participant })
          .include('[data-testid="live-word-cloud-results"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(result.violations, `Live dark cloud at ${width}px`).toEqual([]);
        const image = info.outputPath(`live-word-cloud-dark-${width}.png`);
        await cloud(participant).screenshot({ path: image });
        await info.attach(`Live Observatory word cloud at ${width}px`, {
          path: image,
          contentType: "image/png",
        });
      }
      if (!suffix) {
        await presenter.bringToFront();
        await expectNoCloudCollisions(presenter);
        const image = info.outputPath("live-word-cloud-dark-projection.png");
        await cloud(presenter).screenshot({ path: image, animations: "allow" });
        await info.attach("Live Observatory word cloud on projection", {
          path: image,
          contentType: "image/png",
        });
      }

      const removed = await command(host, room, "response.moderate", {
        answerId: first.answerId,
        responseStatus: "removed",
      });
      for (const audience of audiences) {
        await expectCount(audience, phrase, 1);
        await expect
          .poll(async () => Number(await cloud(audience).getAttribute("data-version")))
          .toBeGreaterThanOrEqual(removed.version);
        await expect(cloud(audience).getByTestId("word-cloud-response-count")).toHaveText(
          "4 responses",
        );
      }
      await command(host, room, "lock");
      await command(host, room, "reveal");
      const finished = await command(host, room, "next");
      expect(finished.phase).toBe("finished");
      expect(finished.competitionStandings?.entries ?? []).toEqual([]);
      if (finished.competitionStandings)
        expect(finished.competitionStandings.status).toBe("unscored");
      await expect(host.getByTestId("host-session")).toHaveAttribute("data-phase", "finished");
      for (const audience of audiences) {
        await audience.bringToFront();
        await expect(cloud(audience)).toBeVisible();
        await expect(cloud(audience).getByTestId("word-cloud-response-count")).toHaveText(
          "4 responses",
        );
        await expect(audience.getByTestId("competition-podium")).toHaveCount(0);
        await expect(audience.getByTestId("competition-race")).toHaveCount(0);
        await expect(audience.getByTestId("scored-response-receipt")).toHaveCount(0);
      }
      await expect(participant.getByRole("tab", { name: "Standings", exact: true })).toHaveCount(0);

      // A separately frozen moderated room retains its reveal and five-person privacy gates.
      const moderated = await createRound(host, "moderated");
      await joinViewer(participant, moderated.room, moderated.guests[0]!);
      const moderatedOpened = await command(host, moderated.room, "start");
      const pending = await submit(
        host,
        moderated.room,
        moderated.guests[0]!,
        moderatedOpened.roundId!,
        "Only reviewed phrases",
      );
      const approvedResults = participant.getByRole("region", {
        name: "Approved responses",
        exact: true,
      });
      await expect(approvedResults).toBeVisible();
      await expect(cloud(participant)).toHaveCount(0);
      await expect(approvedResults).not.toContainText("Only reviewed phrases");
      const pendingQuery = new URLSearchParams({
        roundId: moderatedOpened.roundId!,
        status: "pending",
        clientCapabilities: JSON.stringify(capabilities),
      });
      const queue = await host.request.get(
        `${api}/v1/sessions/${moderated.room.sessionId}/response-moderation?${pendingQuery}`,
        {
          headers: { authorization: `Bearer ${moderated.room.hostToken}` },
        },
      );
      expect(queue.status(), await queue.text()).toBe(200);
      expect((await queue.json()).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ answerId: pending.answerId, status: "pending" }),
        ]),
      );
      await command(host, moderated.room, "response.moderate", {
        answerId: pending.answerId,
        responseStatus: "approved",
      });
      await expect(approvedResults).not.toContainText("Only reviewed phrases");
      await command(host, moderated.room, "lock");
      await command(host, moderated.room, "reveal");
      const publicQuery = new URLSearchParams({
        roundId: moderatedOpened.roundId!,
        role: "participant",
        clientCapabilities: JSON.stringify(capabilities),
      });
      const withheld = await host.request.get(
        `${api}/v1/sessions/${moderated.room.sessionId}/response-results?${publicQuery}`,
        {
          headers: { authorization: `Bearer ${moderated.guests[0]!.participantToken}` },
        },
      );
      expect(withheld.status(), await withheld.text()).toBe(200);
      expect(await withheld.json()).toMatchObject({ visible: false, terms: [] });
      await expect(approvedResults).toContainText("at least five approved respondents");
      await expect(approvedResults).not.toContainText("Only reviewed phrases");
      await expect(cloud(participant)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

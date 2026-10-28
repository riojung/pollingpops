import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { helpVideoScripts, type HelpVideoKey } from "../../apps/web/lib/help-video-scripts";
import { signInBeta } from "../beta-e2e/sign-in";

const baseURL = `http://127.0.0.1:${process.env.BETA_E2E_WEB_PORT ?? 3200}`;
const apiURL = `http://127.0.0.1:${process.env.BETA_E2E_API_PORT ?? 4200}`;
const rawDirectory = path.resolve("artifacts/polling-pops-guides/raw");
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function beat(page: Page, duration = 900) {
  await page.waitForTimeout(duration);
}

async function click(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await beat(page, 450);
  const box = await target.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await target.click();
  await beat(page);
}

async function fill(page: Page, target: Locator, value: string) {
  await target.scrollIntoViewIfNeeded();
  await target.fill(value);
  await beat(page, 750);
}

async function saved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await beat(page);
}

async function writeQuestion(page: Page, completed: number, total: number) {
  await fill(
    page,
    page.getByRole("textbox", { name: "Question prompt", exact: true }),
    `A team completed ${completed} of ${total} safety checks. What percentage were completed?`,
  );
  for (const [index, answer] of ["60%", "70%", "80%", "90%"].entries()) {
    await fill(
      page,
      page.getByRole("textbox", { name: `Answer ${index + 1}`, exact: true }),
      answer,
    );
  }
  await page.getByLabel("Mark choice 3 correct").check();
  await click(page, page.getByRole("tab", { name: "Build", exact: true }));
  await page.getByRole("combobox", { name: /^Time limit/ }).selectOption("120");
  await fill(
    page,
    page.getByLabel("Explanation after reveal", { exact: true }),
    `Divide ${completed} by ${total}, then multiply by 100. The completion rate is 80%.`,
  );
  await saved(page);
  await page
    .getByRole("textbox", { name: "Question prompt", exact: true })
    .scrollIntoViewIfNeeded();
  await beat(page, 1_500);
}

async function answer(page: Page, value: string, confidence = false) {
  await click(page, page.getByRole("button", { name: value, exact: true }));
  if (confidence) await click(page, page.getByRole("button", { name: "Very sure" }));
  await click(page, page.getByRole("button", { name: "Submit response" }));
  await expect(page.getByText("Answer received and saved.")).toBeVisible();
}

test("record current Polling Pops quick start and user guide", async ({ browser }) => {
  await mkdir(path.join(rawDirectory, "tmp"), { recursive: true });
  const contexts: BrowserContext[] = [];
  let creatorState: StorageState | undefined;
  let creatorStorage: Array<[string, string]> = [];
  let quizId = "";
  let sessionId = "";
  let sessionCode = "";
  let participantStorage: Array<[string, string]> = [];

  async function chapter(
    guide: HelpVideoKey,
    index: number,
    route: string,
    action: (page: Page, context: BrowserContext) => Promise<void>,
    creator = true,
  ) {
    const context = await browser.newContext({
      baseURL,
      storageState: creator ? creatorState : undefined,
      viewport: { width: 1280, height: 720 },
      reducedMotion: "reduce",
      colorScheme: "light",
      recordVideo: { dir: path.join(rawDirectory, "tmp"), size: { width: 1280, height: 720 } },
    });
    contexts.push(context);
    await context.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        // Hide development tooling, not product UI. Show a cursor ring for follow-along clicks.
        style.textContent =
          "nextjs-portal{display:none!important}.guide-cursor{position:fixed;width:22px;height:22px;border:2px solid #b02255;border-radius:50%;background:#ffffff66;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);display:none}";
        document.head.append(style);
        const cursor = document.createElement("div");
        cursor.className = "guide-cursor";
        cursor.setAttribute("aria-hidden", "true");
        document.body.append(cursor);
        document.addEventListener("mousemove", (event) => {
          cursor.style.display = "block";
          cursor.style.left = `${event.clientX}px`;
          cursor.style.top = `${event.clientY}px`;
        });
      });
    });
    const resumeStorage = creator ? creatorStorage : participantStorage;
    if (resumeStorage.length) {
      await context.addInitScript((entries) => {
        for (const [key, value] of entries) sessionStorage.setItem(key, value);
      }, resumeStorage);
    }
    const page = await context.newPage();
    await page.goto(route);
    await beat(page, 1_600);
    await action(page, context);
    await beat(page, 2_000);
    if (creator) {
      creatorState = await context.storageState();
      creatorStorage = await page.evaluate(() => Object.entries(sessionStorage));
    }
    const video = page.video()!;
    await context.close();
    await video.saveAs(
      path.join(rawDirectory, `${guide}-${helpVideoScripts[guide][index]!.id}.webm`),
    );
    console.log(`Recorded ${guide}: ${helpVideoScripts[guide][index]!.title}`);
  }

  async function join(record = false) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 720 },
      reducedMotion: "reduce",
      recordVideo: record
        ? { dir: path.join(rawDirectory, "tmp"), size: { width: 1280, height: 720 } }
        : undefined,
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`/join?code=${sessionCode}`);
    await beat(page, 1_300);
    await page.getByTestId("avatar-option-owl").getByText("Owl", { exact: true }).click();
    await beat(page);
    await click(page, page.getByRole("button", { name: "Join round" }));
    await expect(page).toHaveURL(/\/play\//);
    await beat(page, 2_000);
    return { context, page };
  }

  async function controller() {
    const context = await browser.newContext({ baseURL, storageState: creatorState });
    contexts.push(context);
    await context.addInitScript((entries) => {
      for (const [key, value] of entries) sessionStorage.setItem(key, value);
    }, creatorStorage);
    const page = await context.newPage();
    await page.goto(`/host/${sessionId}`);
    await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
    return page;
  }

  try {
    await chapter(
      "quickStart",
      0,
      "/signin",
      async (page) => {
        await signInBeta(page);
        await page.goto("/home");
        await expect(
          page.getByRole("banner").getByRole("button", { name: "Create", exact: true }),
        ).toBeVisible();
        await beat(page, 2_000);
      },
      false,
    );
    // The sign-in chapter starts anonymous, but its ending state belongs to the creator.
    // Retrieve cookies through a separately authenticated, non-recorded fixture.
    const authContext = await browser.newContext({ baseURL });
    contexts.push(authContext);
    const authPage = await authContext.newPage();
    await signInBeta(authPage);
    creatorState = await authContext.storageState();

    await chapter("quickStart", 1, "/home", async (page) => {
      await click(
        page,
        page.getByRole("banner").getByRole("button", { name: "Create", exact: true }),
      );
      await click(page, page.getByRole("link", { name: /^Round\b/ }));
      await click(page, page.getByRole("link", { name: /Start blank/ }));
      await fill(
        page,
        page.getByLabel("Round title (optional for now)"),
        "Safety readiness — first Round",
      );
      await click(page, page.getByRole("button", { name: "Create Round and write question" }));
      await expect(
        page.getByRole("textbox", { name: "Question prompt", exact: true }),
      ).toBeVisible();
      quizId = new URL(page.url()).pathname.split("/").at(-1)!;
    });
    await chapter("quickStart", 2, `/quiz/${quizId}`, async (page) => {
      await writeQuestion(page, 24, 30);
    });
    await chapter("quickStart", 3, `/quiz/${quizId}`, async (page) => {
      await saved(page);
      await click(page, page.getByRole("button", { name: "Preview", exact: true }));
      await expect(page.getByText(/24 of 30 safety checks/)).toBeVisible();
      await click(page, page.getByRole("button", { name: "Reveal answer", exact: true }));
      await click(page, page.getByRole("link", { name: "Back to editor" }));
      await saved(page);
      await click(page, page.getByRole("button", { name: "Publish", exact: true }));
      await expect(page.getByText("published", { exact: true })).toBeVisible();
    });
    await chapter("quickStart", 4, `/host/setup/${quizId}`, async (page) => {
      await click(page, page.locator("summary").filter({ hasText: /Review/ }));
      await expect(page.getByLabel("Scoring mode")).toBeVisible();
      await beat(page, 2_000);
      await click(page, page.getByRole("button", { name: "Create live session" }));
      await expect(page.locator(".session-code")).toBeVisible();
      sessionId = new URL(page.url()).pathname.split("/").at(-1)!;
      sessionCode = (await page.locator(".session-code").textContent())!.trim();
      await page.getByTestId("join-url").scrollIntoViewIfNeeded();
      await beat(page, 2_500);
    });
    const quickHost = await controller();
    await chapter(
      "quickStart",
      5,
      `/join?code=${sessionCode}`,
      async (page) => {
        await click(page, page.getByTestId("avatar-option-owl").getByText("Owl", { exact: true }));
        await click(page, page.getByRole("button", { name: "Join round" }));
        await expect(page).toHaveURL(/\/play\//);
        participantStorage = await page.evaluate(() => Object.entries(sessionStorage));
      },
      false,
    );
    await chapter(
      "quickStart",
      6,
      `/play/${sessionId}`,
      async (page) => {
        await quickHost.getByRole("button", { name: "Start round", exact: true }).click();
        await answer(page, "80%");
        await click(
          quickHost,
          quickHost.getByRole("button", { name: "Lock answers", exact: true }),
        );
        await click(
          quickHost,
          quickHost.getByRole("button", { name: "Reveal answer", exact: true }),
        );
        await expect(page.getByText(/completion rate is 80/)).toBeVisible();
      },
      false,
    );
    await quickHost.getByRole("button", { name: "Finish round", exact: true }).click();
    await expect(quickHost.getByText("Results are ready.")).toBeVisible();
    const reportHref = await quickHost
      .getByTestId("host-stage")
      .getByRole("link", { name: "Open report" })
      .getAttribute("href");
    await chapter("quickStart", 7, reportHref!, async (page) => {
      await expect(page.getByRole("heading", { name: "Recovery evidence" }).last()).toBeVisible();
      await page.mouse.wheel(0, 430);
      await beat(page, 2_500);
      await page.goto("/results");
      await expect(
        page.getByRole("heading", { name: "Results", exact: true, level: 1 }),
      ).toBeVisible();
    });

    await chapter("userGuide", 0, `/quiz/${quizId}`, async (page) => {
      await click(page, page.getByRole("tab", { name: "Build", exact: true }));
      await click(page, page.getByText("Round settings", { exact: true }));
      await page.getByLabel("Round category").selectOption("education");
      await beat(page);
      await click(page, page.getByRole("button", { name: "Use recommended Campus" }));
      await expect(page.getByLabel("Experience preset")).toHaveValue("campus");
      await saved(page);
    });
    await chapter("userGuide", 1, `/quiz/${quizId}`, async (page) => {
      await click(page, page.getByRole("tab", { name: "Diagnose", exact: true }));
      await click(page, page.getByText("Diagnostic details and recheck link", { exact: true }));
      await page.getByRole("combobox", { name: /^Confidence/ }).selectOption("required");
      await fill(page, page.getByRole("textbox", { name: /^Concepts/ }), "completion-rates");
      await click(page, page.getByText("Diagnostic rationale and feedback").nth(1));
      await fill(page, page.getByLabel("Misconception tag for choice 2"), "part-whole-confusion");
      await fill(
        page,
        page.getByLabel("Why someone might choose choice 2"),
        "Compare the completed checks with the whole set, not the remaining checks.",
      );
      await saved(page);
    });
    await chapter("userGuide", 2, `/quiz/${quizId}`, async (page) => {
      await click(page, page.getByRole("tab", { name: "Recover", exact: true }));
      await click(page, page.getByRole("button", { name: "Add a recheck for this concept" }));
      await writeQuestion(page, 40, 50);
      await click(page, page.getByRole("tab", { name: "Diagnose", exact: true }));
      await click(page, page.getByText("Diagnostic details and recheck link", { exact: true }));
      await page.getByRole("combobox", { name: /^Confidence/ }).selectOption("required");
      await saved(page);
      await click(page, page.getByRole("button", { name: "Publish", exact: true }));
      await expect(page.getByText("published", { exact: true })).toBeVisible();
    });
    await chapter("userGuide", 3, "/library", async (page) => {
      await click(
        page,
        page.getByRole("banner").getByRole("button", { name: "Create", exact: true }),
      );
      await click(page, page.getByRole("link", { name: /^Presentation\b/ }));
      await click(page, page.getByRole("button", { name: /Start a blank presentation/i }));
      await expect(page.getByLabel("Presentation title")).toBeVisible();
      await fill(
        page,
        page.getByLabel("Presentation title"),
        "Safety briefing with a comprehension check",
      );
      await fill(
        page,
        page.locator("#presentation-canvas").getByLabel("Slide title", { exact: true }),
        "Safety check briefing",
      );
      await fill(
        page,
        page.locator("#presentation-canvas").getByLabel("Text box 1", { exact: true }),
        "Completed ÷ total × 100.\nExplain the method, then recheck.",
      );
      await saved(page);
      await click(page, page.getByRole("button", { name: "+ Add question", exact: true }));
      await fill(
        page,
        page.getByRole("textbox", { name: "Question prompt", exact: true }),
        "What percentage of 30 checks is 24 completed checks?",
      );
      for (const [index, label] of ["60%", "70%", "80%", "90%"].entries()) {
        await fill(
          page,
          page.getByRole("textbox", { name: `Answer ${index + 1}`, exact: true }),
          label,
        );
      }
      await page.getByLabel("Mark choice 3 correct").check();
      await saved(page);
      await click(page, page.getByRole("button", { name: "Preview", exact: true }));
      await expect(page.getByRole("dialog", { name: "Presentation preview" })).toBeVisible();
      await beat(page, 2_000);
    });
    // Create another session from the newly published diagnostic/recheck version.
    const sessionResponse = await authPage.request.post(`${apiURL}/v1/sessions`, {
      data: {
        quizId,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          confidenceEnabled: true,
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      },
    });
    expect(sessionResponse.status()).toBe(201);
    const session = await sessionResponse.json();
    sessionId = session.sessionId;
    sessionCode = session.code;
    creatorStorage.push([`openround:host:${sessionId}`, session.hostToken]);
    const host = await controller();
    const participants = [];
    for (let i = 0; i < 5; i += 1) participants.push(await join());
    await chapter("userGuide", 4, `/host/${sessionId}`, async (page) => {
      const resume = await participants[0]!.page.evaluate(() => Object.entries(sessionStorage));
      await page.evaluate((entries) => {
        for (const [key, value] of entries) sessionStorage.setItem(key, value);
      }, resume);
      await page.goto(`/play/${sessionId}`);
      await click(page, page.getByTestId("audience-tray").locator("summary"));
      await click(page, page.getByRole("button", { name: "Show an example" }));
      await beat(page, 2_000);
      await page.goto(`/host/${sessionId}`);
      await click(page, page.getByRole("button", { name: "Audience", exact: true }));
      await expect(page.locator(".participant-pulse-table")).toContainText("Show an example");
      await page.locator(".participant-pulse-table").scrollIntoViewIfNeeded();
      await beat(page, 2_500);
    });
    await chapter("userGuide", 5, `/host/${sessionId}`, async (page) => {
      await click(page, page.getByRole("button", { name: "Audience", exact: true }));
      await click(page, page.getByRole("tab", { name: "Chat", exact: true }));
      await click(page, page.getByLabel("Room chat"));
      const participant = participants[0]!.page;
      await participant.getByTestId("audience-tray").locator("summary").click();
      await participant
        .getByLabel("Chat message")
        .fill("Could we work through one practical example?");
      await participant.getByRole("button", { name: "Send", exact: true }).click();
      const message = page.locator(".chat-message", {
        hasText: "Could we work through one practical example?",
      });
      await click(page, message.getByRole("button", { name: "Pin", exact: true }));
      await participant
        .locator(".chat-message", { hasText: "Could we work through one practical example?" })
        .getByRole("button", { name: "Like: 0" })
        .click();
      await participant
        .getByLabel("Ask the facilitator")
        .fill("Why do we divide by the total number of checks?");
      await participant.getByRole("button", { name: "Ask question" }).click();
      await click(page, page.getByRole("tab", { name: "Q&A", exact: true }));
      const question = page.locator(".qna-question", {
        hasText: "Why do we divide by the total number of checks?",
      });
      await expect(question.getByText("Awaiting review")).toBeVisible();
      await click(page, question.getByRole("button", { name: "Publish", exact: true }));
      await fill(
        page,
        question.getByLabel("Facilitator reply"),
        "The total is the whole set. We compare the completed part with that whole.",
      );
      await click(page, question.getByRole("button", { name: "Reply", exact: true }));
    });
    await chapter("userGuide", 6, `/host/${sessionId}`, async (page) => {
      await click(page, page.getByRole("button", { name: "Start round", exact: true }));
      await Promise.all(
        participants.map(({ page: participant }) => answer(participant, "70%", true)),
      );
      await click(page, page.getByRole("button", { name: "Lock answers", exact: true }));
      await click(page, page.getByRole("button", { name: "Reveal answer", exact: true }));
      await expect(page.getByText("Address the confident misconception")).toBeVisible();
      await click(page, page.getByRole("button", { name: "Address the misconception" }));
      await beat(page, 2_500);
      await click(page, page.getByRole("button", { name: "Finish intervention" }));
      await click(page, page.getByRole("button", { name: "Open linked recheck" }));
      await Promise.all(
        participants.map(({ page: participant }, index) =>
          answer(participant, index === 4 ? "70%" : "80%", true),
        ),
      );
      await click(page, page.getByRole("button", { name: "Lock answers", exact: true }));
      await click(page, page.getByRole("button", { name: "Reveal answer", exact: true }));
      await click(page, page.getByRole("button", { name: "Continue after recheck" }));
      await expect(page.getByText("Results are ready.")).toBeVisible();
    });
    await expect(host.getByText("Results are ready.")).toBeVisible();
    const evidenceHref = await host
      .getByTestId("host-stage")
      .getByRole("link", { name: "Open report" })
      .getAttribute("href");
    await chapter("userGuide", 7, evidenceHref!, async (page) => {
      const heading = page.getByRole("heading", { name: "Recovery evidence" }).last();
      await expect(heading).toBeVisible();
      await heading.scrollIntoViewIfNeeded();
      await beat(page, 3_000);
      await expect(page.getByRole("row", { name: /Linked recheck/ })).toContainText("4");
      await page.mouse.wheel(0, 500);
      await beat(page, 2_500);
    });
    await chapter("userGuide", 8, `/quiz/${quizId}/assign`, async (page) => {
      await expect(page.getByRole("heading", { name: "Practice settings" })).toBeVisible();
      await beat(page, 1_500);
      await click(page, page.getByRole("button", { name: "Create assignment", exact: true }));
      await expect(
        page.getByRole("heading", { name: "Save and share these links now" }),
      ).toBeVisible();
      await beat(page, 2_000);
      await page.goto("/assignments");
      await expect(
        page.getByRole("heading", { name: "Assignments", exact: true, level: 1 }),
      ).toBeVisible();
      await beat(page, 1_500);
      await page.goto("/home");
    });
    const recordings: Record<string, string> = {};
    for (const guide of Object.keys(helpVideoScripts) as HelpVideoKey[]) {
      for (const scene of helpVideoScripts[guide]) {
        const filename = `${guide}-${scene.id}.webm`;
        recordings[filename] = createHash("sha256")
          .update(await readFile(path.join(rawDirectory, filename)))
          .digest("hex");
      }
    }
    await writeFile(
      path.join(rawDirectory, "recording.json"),
      JSON.stringify({ recordedAt: new Date().toISOString(), recordings }, null, 2),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

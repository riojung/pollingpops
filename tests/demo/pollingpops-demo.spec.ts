import { signInCreator } from "../support/creator-auth";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = "http://127.0.0.1:3200";
const outputDirectory = path.resolve("artifacts/pollingpops-demo/raw");
const temporaryVideoDirectory = path.join(outputDirectory, "tmp");

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function beat(page: Page, milliseconds = 650) {
  await page.waitForTimeout(milliseconds);
}

async function titleCard(page: Page, eyebrow: string, title: string, description: string) {
  await page.setContent(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            width: 100vw;
            height: 100vh;
            display: grid;
            place-items: center;
            overflow: hidden;
            color: #0a2440;
            background:
              radial-gradient(circle at 88% 18%, rgba(22, 133, 133, .2), transparent 32%),
              radial-gradient(circle at 8% 92%, rgba(240, 177, 89, .22), transparent 34%),
              #fbf8f0;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          main { width: min(980px, 84vw); }
          .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 70px; font-weight: 800; font-size: 28px; }
          .mark { display: grid; place-items: center; width: 50px; height: 50px; border-radius: 10px; color: white; background: #0a2440; }
          .eyebrow { color: #057474; font-size: 18px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
          h1 { max-width: 930px; margin: 18px 0; font-size: 70px; line-height: 1.02; letter-spacing: -.045em; }
          p { max-width: 860px; margin: 0; color: #365778; font-size: 27px; line-height: 1.45; }
          .loop { margin-top: 42px; color: #057474; font-weight: 850; letter-spacing: .02em; }
        </style>
      </head>
      <body>
        <main>
          <div class="brand"><span class="mark">O</span> Polling Pops</div>
          <div class="eyebrow">${eyebrow}</div>
          <h1>${title}</h1>
          <p>${description}</p>
          <p class="loop">Ask → Diagnose → Intervene → Recheck → Prove</p>
        </main>
      </body>
    </html>`);
  await beat(page, 2_600);
}

async function recordedContext(browser: Browser, storageState?: StorageState) {
  return browser.newContext({
    baseURL,
    storageState,
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: temporaryVideoDirectory,
      size: { width: 1280, height: 720 },
    },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
}

async function saveClip(context: BrowserContext, page: Page, filename: string) {
  const video = page.video();
  if (!video) throw new Error(`Video recording was not enabled for ${filename}`);
  await beat(page, 1_000);
  await context.close();
  await video.saveAs(path.join(outputDirectory, filename));
}

async function click(page: Page, locator: ReturnType<Page["locator"]>, pause = 550) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await beat(page, pause);
}

async function fill(page: Page, locator: ReturnType<Page["locator"]>, value: string, pause = 450) {
  await locator.scrollIntoViewIfNeeded();
  await locator.fill(value);
  await beat(page, pause);
}

async function joinParticipant(browser: Browser, code: string, nickname: string) {
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`/join?code=${code}`);
  await page.getByLabel("Nickname").fill(nickname);
  await page.getByRole("button", { name: "Join round" }).click();
  await expect(page).toHaveURL(/\/play\//);
  return { context, page };
}

async function answerChoice(page: Page, choice: string) {
  const choiceButton = page.getByRole("button", { name: choice, exact: true });
  await expect(choiceButton).toBeVisible();
  await choiceButton.click();
  await page.getByRole("button", { name: "Very sure" }).click();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByText("Answer received and saved.")).toBeVisible();
}

test("record the Polling Pops product demo", async ({ browser }) => {
  await mkdir(temporaryVideoDirectory, { recursive: true });

  // Chapter 1: product promise.
  {
    const context = await recordedContext(browser);
    const page = await context.newPage();
    await titleCard(
      page,
      "Product walkthrough",
      "Recover understanding while the moment still matters.",
      "A complete facilitator and participant journey, using a realistic workplace safety checkpoint.",
    );
    await page.goto("/");
    await beat(page, 2_300);
    await page.mouse.wheel(0, 560);
    await beat(page, 2_200);
    await page.mouse.wheel(0, 650);
    await beat(page, 2_000);
    await saveClip(context, page, "01-product-promise.webm");
  }

  let creatorState: StorageState;
  let sessionId: string;
  let sessionCode: string;
  let hostToken: string;

  // Chapter 2: sign in, author a diagnostic checkpoint and a linked recheck, then open a lobby.
  {
    const context = await recordedContext(browser);
    const page = await context.newPage();
    await titleCard(
      page,
      "1 · Ask",
      "Author the evidence you need.",
      "Polling Pops supports scored, unscored, confidence-aware, and linked recheck checkpoints.",
    );
    await signInCreator(page, `demo-${Date.now()}@example.test`, { segment: "education" });
    await beat(page, 1_300);

    await fill(page, page.getByLabel("Checkpoint set title"), "Safety readiness: completion rates");
    await click(page, page.getByRole("button", { name: "Create checkpoint set" }), 1_200);
    await click(page, page.getByRole("button", { name: "Single select" }), 700);

    await fill(
      page,
      page.getByRole("textbox", { name: "Checkpoint prompt", exact: true }),
      "A team completed 24 of 30 safety checks. What percentage were completed?",
    );
    await page.getByLabel("Confidence prompt").selectOption("required");
    await beat(page, 500);
    await fill(page, page.getByLabel("Concept keys"), "completion-rates");
    for (const [index, value] of ["60%", "70%", "80%", "90%"].entries()) {
      await fill(
        page,
        page.getByRole("textbox", { name: `Choice ${index + 1}`, exact: true }),
        value,
        260,
      );
    }
    await page.getByLabel("Mark choice 3 correct").check();
    await beat(page, 450);
    await fill(page, page.getByLabel("Misconception label for choice 2"), "part-whole-confusion");
    await fill(
      page,
      page.getByLabel("Feedback for choice 2"),
      "Divide completed checks by the total number of checks.",
    );
    await fill(
      page,
      page.getByLabel("Explanation after reveal"),
      "Twenty-four divided by thirty is 0.8, so the completion rate is 80 percent.",
    );

    await click(page, page.getByRole("button", { name: "Add linked recheck" }), 750);
    await fill(
      page,
      page.getByRole("textbox", { name: "Checkpoint prompt", exact: true }),
      "A team completed 40 of 50 safety checks. What percentage were completed?",
    );
    for (const [index, value] of ["60%", "70%", "80%", "90%"].entries()) {
      await fill(
        page,
        page.getByRole("textbox", { name: `Choice ${index + 1}`, exact: true }),
        value,
        230,
      );
    }
    await page.getByLabel("Mark choice 3 correct").check();
    await fill(
      page,
      page.getByLabel("Explanation after reveal"),
      "Forty divided by fifty is 0.8, so the completion rate is again 80 percent.",
    );
    await expect(page.getByRole("status")).toContainText("Saved", { timeout: 15_000 });
    await click(page, page.getByRole("button", { name: "Publish" }), 1_200);
    await expect(page.getByText("published", { exact: true })).toBeVisible();
    await click(page, page.getByRole("link", { name: "Dashboard" }), 1_000);
    await click(page, page.getByRole("button", { name: "Host" }), 1_000);
    await page.getByLabel("Maximum participants").fill("100");
    await page
      .getByRole("checkbox", { name: "Ask for confidence (optional)", exact: true })
      .check();
    await beat(page, 450);
    await click(page, page.getByRole("button", { name: "Create live session" }), 1_600);
    await expect(page).toHaveURL(/\/host\/(?!setup\/)[^/]+$/);

    sessionId = new URL(page.url()).pathname.split("/").at(-1)!;
    sessionCode = (await page.locator(".session-code").textContent())!.trim();
    hostToken = (await page.evaluate(
      (id) => sessionStorage.getItem(`openround:host:${id}`),
      sessionId,
    ))!;
    creatorState = await context.storageState();

    await expect(page.getByTestId("join-url")).toBeVisible();
    await beat(page, 2_000);
    await saveClip(context, page, "02-author-and-launch.webm");
  }

  const controllerContext = await browser.newContext({ baseURL, storageState: creatorState! });
  await controllerContext.addInitScript(
    ({ id, token }) => sessionStorage.setItem(`openround:host:${id}`, token),
    { id: sessionId, token: hostToken },
  );
  const controller = await controllerContext.newPage();
  await controller.goto(`/host/${sessionId}`);
  await expect(controller.getByRole("button", { name: "Start round" })).toBeVisible();

  const backgroundParticipants: Array<{ context: BrowserContext; page: Page }> = [];
  for (const nickname of ["Avery", "Jordan", "Morgan", "Riley"]) {
    backgroundParticipants.push(await joinParticipant(browser, sessionCode, nickname));
  }

  let participantToken: string;

  // Chapter 3: account-free joining, moderated Q&A, and a confidence-aware response.
  {
    const context = await recordedContext(browser);
    const page = await context.newPage();
    await titleCard(
      page,
      "2 · Join and respond",
      "No participant account required.",
      "Join with the seven-digit code or QR link, ask a moderated question, and share confidence with the response.",
    );
    await page.goto(`/join?code=${sessionCode}`);
    await beat(page, 1_000);
    await fill(page, page.getByLabel("Nickname"), "Taylor");
    await click(page, page.getByRole("button", { name: "Join round" }), 1_300);
    await fill(
      page,
      page.getByLabel("Ask the facilitator"),
      "Why do we divide completed checks by total checks?",
    );
    await click(page, page.getByRole("button", { name: "Ask question" }), 900);
    await expect(page.getByText("Question sent for facilitator review.")).toBeVisible();

    const question = controller.locator(".qna-question", {
      hasText: "Why do we divide completed checks by total checks?",
    });
    await expect(question.getByText("Awaiting review")).toBeVisible();
    await question.getByRole("button", { name: "Publish" }).click();
    await question
      .getByLabel("Facilitator reply")
      .fill("It compares the completed part with the whole set of required checks.");
    await question.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(
      page.getByText("It compares the completed part with the whole set of required checks."),
    ).toBeVisible();
    await beat(page, 1_000);

    await controller.getByRole("button", { name: "Start round" }).click();
    await expect(page.getByText(/24 of 30 safety checks/)).toBeVisible();
    await beat(page, 900);
    await click(page, page.getByRole("button", { name: /70%/ }), 500);
    await click(page, page.getByRole("button", { name: "Very sure" }), 450);
    await click(page, page.getByRole("button", { name: "Submit response" }), 700);
    await expect(page.getByText("Answer received and saved.")).toBeVisible();

    await Promise.all([
      answerChoice(backgroundParticipants[0].page, "70%"),
      answerChoice(backgroundParticipants[1].page, "70%"),
      answerChoice(backgroundParticipants[2].page, "70%"),
      answerChoice(backgroundParticipants[3].page, "80%"),
    ]);
    participantToken = (await page.evaluate(
      (id) => sessionStorage.getItem(`openround:participant:${id}`),
      sessionId,
    ))!;
    await beat(page, 1_500);
    await saveClip(context, page, "03-participant-experience.webm");
  }

  // Chapter 4: diagnose the signal and record an intervention.
  {
    const context = await recordedContext(browser, creatorState!);
    await context.addInitScript(
      ({ id, token }) => sessionStorage.setItem(`openround:host:${id}`, token),
      { id: sessionId, token: hostToken },
    );
    const page = await context.newPage();
    await titleCard(
      page,
      "3 · Diagnose and intervene",
      "Turn live signals into a teaching decision.",
      "Deterministic guidance explains the measurement and keeps the facilitator in control.",
    );
    await page.goto(`/host/${sessionId}`);
    await expect(page.getByText("5", { exact: true }).last()).toBeVisible();
    await beat(page, 1_200);
    await click(page, page.getByRole("button", { name: "Lock answers" }), 1_000);
    await expect(page.getByText("Facilitator guidance")).toBeVisible();
    await beat(page, 2_200);
    await click(page, page.getByRole("button", { name: "Start peer discussion" }), 1_000);
    await expect(page.getByText(/Active intervention: peer discussion/)).toBeVisible();
    await beat(page, 1_700);
    await click(page, page.getByRole("button", { name: "Finish intervention" }), 800);
    await click(page, page.getByRole("button", { name: "Reveal answer" }), 1_200);
    await click(page, page.getByRole("button", { name: "Record explanation" }), 900);
    await beat(page, 1_400);
    await click(page, page.getByRole("button", { name: "Finish intervention" }), 800);
    await click(page, page.getByRole("button", { name: "Open linked recheck" }), 1_400);
    await expect(page.getByText(/40 of 50 safety checks/)).toBeVisible();
    await beat(page, 1_500);
    await saveClip(context, page, "04-diagnose-and-intervene.webm");
  }

  // Chapter 5: participants apply the idea to a linked recheck.
  {
    const context = await recordedContext(browser);
    await context.addInitScript(
      ({ id, token }) => sessionStorage.setItem(`openround:participant:${id}`, token),
      { id: sessionId, token: participantToken },
    );
    const page = await context.newPage();
    await titleCard(
      page,
      "4 · Recheck",
      "Verify recovery with new evidence.",
      "A linked checkpoint tests transfer to a fresh example; a same-question revote remains available when needed.",
    );
    await page.goto(`/play/${sessionId}`);
    await expect(page.getByText(/40 of 50 safety checks/)).toBeVisible();
    await beat(page, 1_000);
    await click(page, page.getByRole("button", { name: /80%/ }), 450);
    await click(page, page.getByRole("button", { name: "Very sure" }), 400);
    await click(page, page.getByRole("button", { name: "Submit response" }), 700);

    await Promise.all([
      answerChoice(backgroundParticipants[0].page, "80%"),
      answerChoice(backgroundParticipants[1].page, "80%"),
      answerChoice(backgroundParticipants[2].page, "70%"),
      answerChoice(backgroundParticipants[3].page, "80%"),
    ]);
    await beat(page, 1_800);
    await saveClip(context, page, "05-linked-recheck.webm");
  }

  // Chapter 6: finish the round, review recovery evidence, and create a follow-up.
  {
    const context = await recordedContext(browser, creatorState!);
    await context.addInitScript(
      ({ id, token }) => sessionStorage.setItem(`openround:host:${id}`, token),
      { id: sessionId, token: hostToken },
    );
    const page = await context.newPage();
    await titleCard(
      page,
      "5 · Prove and follow up",
      "See who recovered—and what remains unresolved.",
      "Reports separate linked-recheck evidence from revotes and turn unresolved concepts into private follow-up links.",
    );
    await page.goto(`/host/${sessionId}`);
    await expect(page.getByRole("button", { name: "Lock answers" })).toBeVisible();
    await click(page, page.getByRole("button", { name: "Lock answers" }), 750);
    await click(page, page.getByRole("button", { name: "Reveal answer" }), 1_050);
    await click(page, page.getByRole("button", { name: "Continue after recheck" }), 1_500);
    await expect(page.getByText("Results are ready.")).toBeVisible();
    await click(page, page.getByRole("link", { name: "Open report" }), 1_700);

    await expect(
      page
        .locator(".metric")
        .filter({ hasText: "initial accuracy" })
        .getByText("20%", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await beat(page, 2_200);
    await page.getByRole("heading", { name: "Recovery evidence" }).last().scrollIntoViewIfNeeded();
    await beat(page, 1_800);
    await page
      .getByRole("heading", { name: "Confidence and correctness" })
      .scrollIntoViewIfNeeded();
    await beat(page, 1_600);
    await page.getByRole("heading", { name: "Concept follow-up" }).scrollIntoViewIfNeeded();
    await beat(page, 1_600);
    await page.getByRole("heading", { name: "Self-paced follow-up" }).scrollIntoViewIfNeeded();
    await beat(page, 1_300);
    await click(page, page.getByRole("button", { name: "Create follow-up and links" }), 1_500);
    await expect(page.getByText("Save these links now.")).toBeVisible();
    await beat(page, 2_200);
    await page.getByLabel("Accommodation pass label").fill("Extended time");
    await page.getByLabel("Time allowance").selectOption("1.5");
    await click(page, page.getByRole("button", { name: "Create private pass" }), 1_200);
    await expect(page.getByText("Save this new pass now:")).toBeVisible();
    await beat(page, 1_500);
    await saveClip(context, page, "06-evidence-and-followup.webm");
  }

  // Chapter 7: summarize the best-fit use cases.
  {
    const context = await recordedContext(browser, creatorState!);
    const page = await context.newPage();
    await titleCard(
      page,
      "Where Polling Pops fits",
      "Higher education. Technical training. Safety and compliance.",
      "Use the same privacy-preserving Recovery Loop anywhere a facilitator needs to know what landed—and what to do next.",
    );
    await page.goto("/dashboard");
    await beat(page, 2_400);
    await page.mouse.wheel(0, 480);
    await beat(page, 1_800);
    await titleCard(
      page,
      "Polling Pops",
      "Ask. Diagnose. Intervene. Recheck. Prove.",
      "Run it as the Apache-2.0 Community edition or use the hosted service. Participants still need only a code or QR link.",
    );
    await saveClip(context, page, "07-use-cases.webm");
  }

  await Promise.all(backgroundParticipants.map(({ context }) => context.close()));
  await controllerContext.close();
});

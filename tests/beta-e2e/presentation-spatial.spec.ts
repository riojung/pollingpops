import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import {
  PresentationSpatialSnapshotSchema,
  type InteractiveQuestionBlockDraft,
  type PresentationContent,
  type PresentationHostSnapshot,
  type PresentationParticipantSnapshot,
  type PresentationSpatialSnapshot,
  type PresentationStageSnapshot,
} from "../../packages/contracts/src/index.ts";
import {
  closeE01Overlays,
  clickEditorAction,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const privateMarker = "PRIVATE E10 facilitator cue";
const sectionMarker = "SECTION E10 future grouping";
const hiddenMarker = "HIDDEN E10 planning secret";
const rationale = "UNREVEALED E10 answer rationale";
const spatialPanel = (page: Page) =>
  page.getByRole("region", { name: "Presentation spatial path", exact: true });

function checkpoint(prompt: string): InteractiveQuestionBlockDraft {
  return {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "multi_select",
      prompt,
      choices: [
        { id: randomUUID(), label: "Supported evidence", isCorrect: true },
        { id: randomUUID(), label: "Unsupported assumption", isCorrect: false },
      ],
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["spatial-synthetic"],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 100,
      explanation: rationale,
      mediaId: null,
      mediaAlt: null,
    },
  };
}

async function openArrange(page: Page) {
  await clickEditorAction(page, "Arrange space");
  const dialog = page.getByRole("dialog", { name: "Arrange space", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createFixture(page: Page, info: TestInfo) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signInBeta(page);
  const suffix = randomUUID().slice(0, 8);
  const opening = e01Slide(`Spatial opening ${suffix}`);
  opening.speakerNotes = privateMarker;
  opening.citations = [{ locator: privateMarker, excerpt: "PRIVATE E10 source evidence" }];
  const hidden = { ...e01Slide(`${hiddenMarker} ${suffix}`), hidden: true as const };
  const diagnostic = checkpoint(`FUTURE E10 diagnostic ${suffix}`);
  const recheck = checkpoint(`FUTURE E10 recheck ${suffix}`);
  recheck.question.delivery = "recheck";
  diagnostic.question.linkedRecheckQuestionId = recheck.question.id;
  const closing = e01Slide(`FUTURE E10 closing ${suffix}`);
  const record = await createE01Deck(page, [opening, hidden, diagnostic, recheck, closing], 7);
  expect(record.draft.schemaVersion).toBe(7);
  const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
  await enterE01Editor(page, record.id, narrow);
  let arrange = await openArrange(page);
  await arrange.getByRole("button", { name: "Enable spatial layout", exact: true }).click();
  await arrange
    .getByRole("combobox", { name: "Selected frame", exact: true })
    .selectOption(closing.id);
  await arrange.getByRole("spinbutton", { name: "Frame X", exact: true }).fill("18000");
  await arrange.getByRole("spinbutton", { name: "Frame Y", exact: true }).fill("17000");
  const widthInput = arrange.getByRole("spinbutton", { name: "Frame width", exact: true });
  await widthInput.focus();
  await widthInput.press("ControlOrMeta+A");
  await widthInput.press("Backspace");
  await expect(widthInput).toHaveValue("");
  await widthInput.pressSequentially("640");
  await expect(widthInput).toHaveValue("640");
  await expect
    .poll(
      async () =>
        (await readE01Record(page, record.id)).draft.spatial?.frames.find(
          (frame) => frame.blockId === closing.id,
        )?.width,
    )
    .toBe(1280);
  await widthInput.press("Tab");
  await expect
    .poll(
      async () =>
        (await readE01Record(page, record.id)).draft.spatial?.frames.find(
          (frame) => frame.blockId === closing.id,
        )?.width,
    )
    .toBe(640);
  await widthInput.fill("1600");
  await widthInput.press("Tab");
  await expect
    .poll(async () =>
      (await readE01Record(page, record.id)).draft.spatial?.frames.find(
        (frame) => frame.blockId === closing.id,
      ),
    )
    .toMatchObject({ x: 18000, y: 17000, width: 1600, height: 900 });
  await arrange.getByRole("button", { name: "Close arrange space", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await readE01Record(page, record.id)).draft.spatial?.frames.find(
          (frame) => frame.blockId === closing.id,
        )?.width,
    )
    .toBe(640);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await readE01Record(page, record.id)).draft.spatial?.frames.find(
          (frame) => frame.blockId === closing.id,
        )?.width,
    )
    .toBe(1600);
  await page.reload();
  if (narrow) await closeE01Overlays(page);
  arrange = await openArrange(page);
  await arrange
    .getByRole("combobox", { name: "Selected frame", exact: true })
    .selectOption(closing.id);
  await expect(arrange.getByRole("spinbutton", { name: "Frame X", exact: true })).toHaveValue(
    "18000",
  );
  await expect(arrange.getByRole("spinbutton", { name: "Frame Y", exact: true })).toHaveValue(
    "17000",
  );
  await expect(arrange.getByRole("spinbutton", { name: "Frame width", exact: true })).toHaveValue(
    "1600",
  );
  await arrange.getByRole("button", { name: "Fit all", exact: true }).click();
  const resetFrame = arrange.getByRole("button", { name: "Reset selected frame", exact: true });
  await resetFrame.scrollIntoViewIfNeeded();
  await expect(resetFrame).toBeInViewport({ ratio: 1 });
  if (!narrow) {
    const controls = arrange.getByRole("complementary", {
      name: "Spatial frame controls",
      exact: true,
    });
    const playbackOrder = arrange.getByRole("list", {
      name: "Spatial frames in playback order",
      exact: true,
    });
    await expect
      .poll(
        async () => {
          const [button, pane, list] = await Promise.all([
            resetFrame.boundingBox(),
            controls.boundingBox(),
            playbackOrder.boundingBox(),
          ]);
          return {
            insideControls:
              !!button &&
              !!pane &&
              button.x >= pane.x &&
              button.y >= pane.y &&
              button.x + button.width <= pane.x + pane.width &&
              button.y + button.height <= pane.y + pane.height,
            abovePlaybackOrder: !!button && !!list && button.y + button.height <= list.y,
          };
        },
        {
          message:
            "Selected frame controls must stay inside their scrolling pane above the playback list",
        },
      )
      .toEqual({ insideControls: true, abovePlaybackOrder: true });
  } else {
    await noOverflow(page);
  }
  await arrange.getByRole("spinbutton", { name: "Frame X", exact: true }).scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await arrange.screenshot({ path: info.outputPath("e10-arrange-space.png") });
  await arrange.getByRole("button", { name: "Preview path", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Presentation preview", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByText(hiddenMarker, { exact: false })).toHaveCount(0);
  await expect(preview.locator("[data-spatial-page]")).toHaveCount(4);
  await preview.getByRole("button", { name: "Next", exact: true }).click();
  await expect(spatialPanel(page)).toContainText("Page 2 of 4");
  await preview.getByRole("button", { name: "Close preview", exact: true }).click();
  const map = page.getByRole("complementary", { name: "Presentation map", exact: true });
  if (!(await map.isVisible()))
    await page.getByRole("button", { name: "Open map", exact: true }).click();
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Section 1 name", { exact: true }).fill(sectionMarker);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Selected block section", exact: true })
    .selectOption({ label: sectionMarker });
  await expect
    .poll(async () => (await readE01Record(page, record.id)).draft.sections?.[0]?.blockIds)
    .toContain(closing.id);
  if (narrow) await page.getByRole("button", { name: "Collapse map", exact: true }).click();
  const publishing = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await publishing;
  expect(published.status(), await published.text()).toBe(200);
  const version = (await published.json()).version as { id: string; content: PresentationContent };
  expect(version.content.schemaVersion).toBe(14);
  expect(version.content.blocks.map((block) => block.id)).toEqual([
    opening.id,
    diagnostic.id,
    recheck.id,
    closing.id,
  ]);
  expect(version.content.spatial?.frames).toHaveLength(4);
  expect(JSON.stringify(version.content)).not.toContain(hiddenMarker);
  expect(JSON.stringify(version.content.spatial)).not.toContain(hidden.id);
  const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
    data: { presentationId: record.id, timeMode: "flex" },
  });
  expect(created.status()).toBe(201);
  const { snapshot, controlToken } = (await created.json()) as {
    snapshot: PresentationHostSnapshot;
    controlToken: string;
  };
  expect(snapshot.presentationVersionId).toBe(version.id);
  const frozen = PresentationSpatialSnapshotSchema.parse(snapshot.spatial);
  expect(frozen.frames).toHaveLength(4);
  expect(frozen.frames[3]).toMatchObject({
    blockIndex: 3,
    x: 18000,
    y: 17000,
    width: 1600,
    height: 900,
  });
  await page.evaluate(
    ({ sessionId, controlToken }) =>
      sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
    { sessionId: snapshot.sessionId, controlToken },
  );

  // Publish a new title and position after session creation through the normal creator APIs.
  const current = await readE01Record(page, record.id);
  const later = {
    ...current.draft,
    spatial: {
      schemaVersion: 1,
      frames: current.draft.spatial!.frames.map((frame) =>
        frame.blockId === closing.id ? { ...frame, x: 320, y: 12000 } : frame,
      ),
    },
    blocks: current.draft.blocks.map((block) =>
      block.id === closing.id && block.kind === "content"
        ? {
            ...block,
            scene: {
              ...block.scene!,
              nodes: block.scene!.nodes.map((node) =>
                node.type === "text" && node.role === "title"
                  ? { ...node, text: "LATER E10 publication text" }
                  : node,
              ),
            },
          }
        : block,
    ),
  };
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
    data: {
      draft: later,
      expectedRevision: current.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  const secondPublication = await page.request.post(
    `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
    { data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision } },
  );
  expect(secondPublication.status()).toBe(200);
  expect((await secondPublication.json()).version.id).not.toBe(version.id);
  await page.goto(`/presentation-session/${snapshot.sessionId}/host`);
  const companionPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Launch companion", exact: true }).click();
  const companion = await companionPopup;
  await expect(spatialPanel(companion)).toBeVisible();
  const stagePopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
  const stage = await stagePopup;
  await stage.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  return {
    record,
    sessionId: snapshot.sessionId,
    code: snapshot.code,
    versionId: version.id,
    frozen,
    opening,
    hidden,
    diagnostic,
    recheck,
    closing,
    companion,
    stage,
  };
}

async function join(browser: Browser, host: Page, code: string, info: TestInfo) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({
    baseURL: new URL(host.url()).origin,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const frames: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
  );
  await page.goto(`/join?code=${code}`);
  await page.getByLabel("Nickname", { exact: true }).fill("E10 synthetic participant");
  await page.getByRole("button", { name: "Join presentation", exact: true }).click();
  await expect(page).toHaveURL(/\/presentation-session\/[^/]+\/play$/);
  return { context, page, frames };
}

async function hostSnapshot(page: Page, sessionId: string): Promise<PresentationHostSnapshot> {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${sessionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}
async function publicSnapshot(
  page: Page,
  sessionId: string,
  role: "participant",
): Promise<PresentationParticipantSnapshot>;
async function publicSnapshot(
  page: Page,
  sessionId: string,
  role: "stage",
): Promise<PresentationStageSnapshot>;
async function publicSnapshot(page: Page, sessionId: string, role: "participant" | "stage") {
  const token = await page.evaluate(
    ({ sessionId, role }) => sessionStorage.getItem(`openround:presentation-${role}:${sessionId}`),
    { sessionId, role },
  );
  expect(token).toBeTruthy();
  const response = await page.request.get(
    `${e01ApiUrl}/v1/presentation-sessions/${sessionId}/${role}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}
function assertSpatial(value: unknown, frozen: PresentationSpatialSnapshot, forbidden: string[]) {
  const parsed = PresentationSpatialSnapshotSchema.parse(value);
  expect(parsed).toEqual(frozen);
  const json = JSON.stringify(value);
  for (const secret of forbidden) expect(json).not.toContain(secret);
  expect(json).not.toMatch(/blockId|title|section|kind|question|speaker|media|response|scene/);
}
function socketSpatial(frames: string[]) {
  const found: unknown[] = [];
  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "spatial") found.push(nested);
      else walk(nested);
    }
  }
  for (const frame of frames) {
    const packet = frame.match(/^4[23]\d*(\[.*)$/s);
    if (packet) walk(JSON.parse(packet[1]!));
  }
  return found;
}
async function jump(page: Page, blockId: string) {
  const panel = spatialPanel(page);
  await panel.getByRole("combobox", { name: "Jump to page", exact: true }).selectOption(blockId);
  await panel.getByRole("button", { name: "Jump to selected page", exact: true }).click();
}
async function noOverflow(page: Page) {
  try {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
        message: "Document must fit the viewport after responsive layout settles",
      })
      .toBe(true);
  } catch (error) {
    const diagnostics = await page
      .evaluate(() => {
        const clipped = (element: Element) => {
          for (
            let parent = element.parentElement;
            parent && parent !== document.body;
            parent = parent.parentElement
          ) {
            if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX))
              return true;
          }
          return false;
        };
        return {
          path: location.pathname,
          viewport: {
            width: innerWidth,
            height: innerHeight,
            visualWidth: visualViewport?.width ?? null,
          },
          document: {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          },
          body: { clientWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth },
          overflowingElements: [...document.body.querySelectorAll("*")]
            .filter(
              (element) =>
                element.namespaceURI !== "http://www.w3.org/2000/svg" && !clipped(element),
            )
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                class: (element.getAttribute("class") ?? "").slice(0, 160),
                left: Math.round(rect.left * 100) / 100,
                right: Math.round(rect.right * 100) / 100,
                width: Math.round(rect.width * 100) / 100,
              };
            })
            .filter(
              (element) => element.width > 0 && (element.right > innerWidth || element.left < 0),
            )
            .sort((a, b) => b.right - a.right)
            .slice(0, 15),
        };
      })
      .catch(() => ({ path: new URL(page.url()).pathname, diagnosticsUnavailable: true }));
    await test.info().attach("e10-horizontal-overflow.json", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
    throw error;
  }
}
const windowState = (snapshot: PresentationHostSnapshot) => ({
  revision: snapshot.revision,
  phase: snapshot.phase,
  currentBlockIndex: snapshot.currentBlockIndex,
  questionOpenedAt: snapshot.questionOpenedAt,
  questionClosesAt: snapshot.questionClosesAt,
  acceptingResponses: snapshot.acceptingResponses,
  responseCount: snapshot.responseCount,
});
async function answer(page: Page, correct: boolean) {
  const choice = page.getByRole("button", {
    name: correct ? "Supported evidence" : "Unsupported assumption",
    exact: true,
  });
  if ((await choice.getAttribute("aria-pressed")) !== "true") await choice.click();
  await page.getByRole("button", { name: "Submit response", exact: true }).click();
  await expect(
    page.getByText("Response saved. You can stay here while the facilitator continues.", {
      exact: true,
    }),
  ).toBeVisible();
}

for (const suffix of ["", " @mobile"]) {
  test(`spatial delivery preserves frozen private geometry, local responses and linked recovery${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const fixture = await createFixture(page, info);
    const guest = await join(browser, page, fixture.code, info);
    try {
      const forbidden = [
        privateMarker,
        hiddenMarker,
        sectionMarker,
        fixture.hidden.id,
        fixture.opening.id,
        fixture.diagnostic.id,
        fixture.recheck.id,
        fixture.closing.id,
        fixture.diagnostic.question.prompt,
        fixture.recheck.question.prompt,
        "LATER E10 publication text",
      ];
      for (const surface of [page, fixture.companion, fixture.stage, guest.page]) {
        await expect(spatialPanel(surface)).toContainText("Overview · 4 pages");
        await expect(spatialPanel(surface).locator("svg")).toHaveAttribute("aria-hidden", "true");
        await expect(spatialPanel(surface).locator("svg")).toHaveAttribute("focusable", "false");
        await noOverflow(surface);
      }
      expect((await hostSnapshot(page, fixture.sessionId)).spatial).toEqual(fixture.frozen);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      await expect(guest.page.getByRole("heading", { name: /^Spatial opening/ })).toBeVisible();
      for (const [surface, role] of [
        [guest.page, "participant"],
        [fixture.stage, "stage"],
      ] as const) {
        const projected =
          role === "participant"
            ? await publicSnapshot(surface, fixture.sessionId, role)
            : await publicSnapshot(surface, fixture.sessionId, role);
        expect(projected.presentationVersionId).toBe(fixture.versionId);
        assertSpatial(projected.spatial, fixture.frozen, forbidden);
        const json = JSON.stringify(projected);
        for (const secret of [
          privateMarker,
          hiddenMarker,
          sectionMarker,
          fixture.hidden.id,
          fixture.diagnostic.id,
          fixture.recheck.id,
          fixture.closing.id,
          fixture.diagnostic.question.prompt,
          fixture.recheck.question.prompt,
          rationale,
          "LATER E10 publication text",
        ])
          expect(json).not.toContain(secret);
      }
      await expect.poll(() => socketSpatial(guest.frames).length).toBeGreaterThan(0);
      for (const projected of socketSpatial(guest.frames))
        assertSpatial(projected, fixture.frozen, forbidden);
      expect(guest.frames.join("\n")).not.toContain(fixture.diagnostic.question.prompt);
      expect(guest.frames.join("\n")).not.toContain(fixture.recheck.question.prompt);
      // Staff selects an exact immutable target; the direct recheck remains unavailable.
      await spatialPanel(page)
        .getByRole("combobox", { name: "Jump to page", exact: true })
        .selectOption(fixture.recheck.id);
      await expect(
        spatialPanel(page).getByRole("button", { name: "Jump to selected page", exact: true }),
      ).toBeDisabled();
      await jump(page, fixture.closing.id);
      await expect(spatialPanel(guest.page)).toContainText("Page 4 of 4");
      await expect(spatialPanel(fixture.companion)).toContainText("Page 4 of 4");
      await expect(
        fixture.stage.getByRole("heading", { name: /^FUTURE E10 closing/ }),
      ).toBeVisible();
      await jump(fixture.companion, fixture.opening.id);
      await expect(spatialPanel(page)).toContainText("Page 1 of 4");
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(
        guest.page.getByRole("heading", { name: fixture.diagnostic.question.prompt, exact: true }),
      ).toBeVisible();
      await guest.page.getByRole("button", { name: "Unsupported assumption", exact: true }).click();
      const selected = guest.page.getByRole("button", {
        name: "Unsupported assumption",
        exact: true,
      });
      await expect(selected).toHaveAttribute("aria-pressed", "true");
      const originalResponseControl = await selected.elementHandle();
      if (!originalResponseControl) throw new Error("Unsent response control must be mounted");
      const beforeLocal = windowState(await hostSnapshot(page, fixture.sessionId));
      const panel = spatialPanel(guest.page);
      const overviewButton = panel.getByRole("button", { name: "Show overview", exact: true });
      await overviewButton.focus();
      await overviewButton.press("Enter");
      await expect(overviewButton).toBeFocused();
      await panel.getByRole("button", { name: "Use linear view", exact: true }).click();
      await expect(panel.locator("[data-spatial-view]")).toBeHidden();
      await expect(selected).toHaveAttribute("aria-pressed", "true");
      await panel.getByRole("button", { name: "Use spatial view", exact: true }).click();
      await panel.getByRole("button", { name: "Focus current page", exact: true }).click();
      await expect(selected).toHaveAttribute("aria-pressed", "true");
      expect(
        await selected.evaluate(
          (element, original) => element === original,
          originalResponseControl,
        ),
      ).toBe(true);
      await originalResponseControl.dispose();
      expect(windowState(await hostSnapshot(page, fixture.sessionId))).toEqual(beforeLocal);
      expect(
        (await publicSnapshot(guest.page, fixture.sessionId, "participant")).responseSubmitted,
      ).toBe(false);
      await spatialPanel(fixture.companion)
        .getByRole("combobox", { name: "Jump to page", exact: true })
        .selectOption(fixture.closing.id);
      await expect(
        spatialPanel(fixture.companion).getByRole("button", {
          name: "Jump to selected page",
          exact: true,
        }),
      ).toBeDisabled();
      // Motion is bounded on ordinary displays and removed by the actual reduced-motion media rule.
      await fixture.stage.emulateMedia({ reducedMotion: "no-preference" });
      expect(
        await spatialPanel(fixture.stage)
          .locator("svg > g")
          .evaluate((element) =>
            getComputedStyle(element)
              .transitionDuration.split(",")
              .every((duration) => parseFloat(duration) > 0 && parseFloat(duration) <= 0.35),
          ),
      ).toBe(true);
      await fixture.stage.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await spatialPanel(fixture.stage)
          .locator("svg > g")
          .evaluate((element) =>
            getComputedStyle(element)
              .transitionDuration.split(",")
              .every((duration) => parseFloat(duration) === 0),
          ),
      ).toBe(true);
      for (const surface of [guest.page, fixture.companion]) {
        await surface.setViewportSize({
          width: 320,
          height: info.project.use.viewport?.height ?? 844,
        });
        await noOverflow(surface);
        expect((await new AxeBuilder({ page: surface }).analyze()).violations).toEqual([]);
      }
      await guest.page.screenshot({
        path: info.outputPath("e10-participant-local-response-320.png"),
        fullPage: true,
      });
      await fixture.companion.screenshot({
        path: info.outputPath("e10-companion-spatial-320.png"),
        fullPage: true,
      });
      await answer(guest.page, false);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await expect(
        spatialPanel(fixture.companion).getByRole("button", {
          name: "Jump to selected page",
          exact: true,
        }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "Present intervention", exact: true }).click();
      await expect
        .poll(async () => (await hostSnapshot(page, fixture.sessionId)).phase)
        .toBe("intervention");
      const savedDiagnostic = await hostSnapshot(page, fixture.sessionId);
      expect(savedDiagnostic.currentBlock?.id).toBe(fixture.diagnostic.id);
      expect(savedDiagnostic.acceptingResponses).toBe(false);
      await expect(spatialPanel(guest.page)).toContainText("Page 2 of 4");
      await page.getByRole("button", { name: "Continue to recheck", exact: true }).click();
      await expect(
        guest.page.getByRole("heading", { name: fixture.recheck.question.prompt, exact: true }),
      ).toBeVisible();
      await answer(guest.page, true);
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await expect
        .poll(async () => (await hostSnapshot(page, fixture.sessionId)).phase)
        .toBe("question_reveal");
      const closed = await hostSnapshot(page, fixture.sessionId);
      const receipt = (await publicSnapshot(guest.page, fixture.sessionId, "participant"))
        .responseReceipt;
      await page.getByRole("button", { name: "Next block", exact: true }).click();
      await expect(spatialPanel(fixture.companion)).toContainText("Page 4 of 4");
      await jump(fixture.companion, fixture.diagnostic.id);
      await expect(spatialPanel(page)).toContainText("Page 2 of 4");
      const revisit = await hostSnapshot(page, fixture.sessionId);
      expect(revisit).toMatchObject({
        phase: savedDiagnostic.phase,
        currentBlock: { id: savedDiagnostic.currentBlock!.id },
        questionOpenedAt: savedDiagnostic.questionOpenedAt,
        questionClosesAt: savedDiagnostic.questionClosesAt,
        acceptingResponses: savedDiagnostic.acceptingResponses,
      });
      expect(revisit.participants.map(({ id, score }) => ({ id, score }))).toEqual(
        closed.participants.map(({ id, score }) => ({ id, score })),
      );
      expect(
        (await publicSnapshot(guest.page, fixture.sessionId, "participant")).responseReceipt,
      ).toEqual(receipt);
      await expect(
        guest.page.getByRole("button", { name: "Submit response", exact: true }),
      ).toHaveCount(0);
      await jump(page, fixture.closing.id);
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      for (const surface of [page, fixture.companion, fixture.stage, guest.page]) {
        await expect(spatialPanel(surface)).toContainText("Presentation complete · 4 pages");
        await noOverflow(surface);
      }
      await fixture.stage.screenshot({
        path: info.outputPath("e10-audience-overview.png"),
        fullPage: true,
      });
      expect(guest.frames.join("\n")).not.toMatch(
        /PRIVATE E10|HIDDEN E10|SECTION E10|LATER E10 publication text|"speakerNotes"|"sourceCitations"|"presenter"|"navigation"/,
      );
      for (const projected of socketSpatial(guest.frames))
        assertSpatial(projected, fixture.frozen, forbidden);
    } finally {
      await guest.context.close();
      await fixture.companion.close();
      await fixture.stage.close();
    }
  });
}

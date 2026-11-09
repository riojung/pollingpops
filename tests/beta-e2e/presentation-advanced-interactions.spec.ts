import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type {
  InteractiveQuestionBlockDraft,
  PresentationDraft,
  PresentationHostSnapshot,
} from "../../packages/contracts/src/index.ts";
import {
  openE01Inspector,
  selectE01Object,
  clickNativeInsert,
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
  selectE01Block,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.skip(
  process.env.BETA_E2E_VISUAL_IMPORTS !== "true",
  "Requires the opt-in loopback storage and synthetic clean-scanner fixture for real image uploads.",
);
test.use({ actionTimeout: 30_000 });
const broadcastBody = "BROADCAST E06 evidence withheld until the facilitator reveals it.";
const localBody = "LOCAL E06 detail. Compare the two workflow steps before proceeding.";
const privateMarker = "PRIVATE E06 facilitator material";

/** A deterministic PNG diagram; the normal upload/scan/media authorization path is exercised. */
function diagramPng() {
  function chunk(name: string, data: Buffer) {
    const type = Buffer.from(name);
    const bytes = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, bytes, checksum]);
  }
  const width = 320;
  const height = 180;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      const colour =
        x > 24 && x < 140 && y > 50 && y < 130
          ? [35, 88, 165]
          : x > 180 && x < 296 && y > 50 && y < 130
            ? [21, 118, 83]
            : [238, 243, 248];
      pixels[offset] = colour[0]!;
      pixels[offset + 1] = colour[1]!;
      pixels[offset + 2] = colour[2]!;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function checkpoint(prompt: string): InteractiveQuestionBlockDraft {
  return {
    id: randomUUID(),
    kind: "question",
    question: {
      id: randomUUID(),
      type: "single_select",
      prompt,
      choices: [
        { id: randomUUID(), label: "Evidence supported", isCorrect: true },
        { id: randomUUID(), label: "Unsupported assumption", isCorrect: false },
      ],
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["advanced-interactions"],
      linkedRecheckQuestionId: null,
      timeLimitSeconds: 300,
      basePoints: 100,
      explanation: "UNREVEALED E06 answer rationale",
      mediaId: null,
      mediaAlt: null,
    },
  };
}

async function saveGeometry(
  page: Page,
  fields: Partial<Record<"x" | "y" | "width" | "height", number>>,
) {
  await openE01Inspector(page, "Layout");
  for (const [field, value] of Object.entries(fields))
    await page
      .getByRole("spinbutton", { name: `Object ${field} (%)`, exact: true })
      .fill(String(value));
}

async function createFixture(page: Page, info: TestInfo) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await signInBeta(page);
  const suffix = randomUUID().slice(0, 8);
  const opening = e01Slide(`Advanced opening ${suffix}`);
  opening.scene!.nodes = opening.scene!.nodes.slice(0, 1);
  opening.scene!.readingOrder = opening.scene!.nodes.map((node) => node.id);
  opening.speakerNotes = privateMarker;
  const question = checkpoint(`Advanced checkpoint ${suffix}`);
  const skipped = e01Slide(`Unvisited context ${suffix}`);
  const target = e01Slide(`Branch target ${suffix}`);
  const closing = e01Slide(`Advanced closing ${suffix}`);
  if (!("choices" in question.question)) throw new Error("Choice checkpoint required");
  const record = await createE01Deck(page, [opening, question, skipped, target, closing]);
  const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
  await enterE01Editor(page, record.id, narrow);
  await openE01Inspector(page, "Media");
  await page.getByLabel("New image description", { exact: true }).fill("Two workflow steps");
  await page
    .getByLabel("Add native image", { exact: true })
    .setInputFiles({ name: "workflow-diagram.png", mimeType: "image/png", buffer: diagramPng() });
  await expect
    .poll(async () => {
      const block = (await readE01Record(page, record.id)).draft.blocks[0];
      return block?.kind === "content" && block.scene?.nodes.some((node) => node.type === "image");
    })
    .toBe(true);
  await clickNativeInsert(page, "Add image hotspot");
  await page.getByRole("textbox", { name: "Detail button label", exact: true }).fill("Inspect");
  await page.getByRole("textbox", { name: "Detail title", exact: true }).fill("Workflow detail");
  await page.getByRole("textbox", { name: "Detail audience content", exact: true }).fill(localBody);
  await expect
    .poll(async () => {
      const block = (await readE01Record(page, record.id)).draft.blocks[0];
      return block?.kind === "content"
        ? block.scene?.nodes.find((node) => node.type === "hotspot")?.body
        : null;
    })
    .toBe(localBody);
  const beforeMove = (await readE01Record(page, record.id)).draft.blocks[0]!;
  await selectE01Object(page, /Two workflow steps/, "Layout");
  await saveGeometry(page, { x: 56, width: 34 });
  await expect
    .poll(async () => {
      const block = (await readE01Record(page, record.id)).draft.blocks[0];
      const image =
        block?.kind === "content" ? block.scene?.nodes.find((node) => node.type === "image") : null;
      return image ? { x: image.frame.x, width: image.frame.width } : null;
    })
    .toEqual({ x: 56, width: 34 });
  const moved = (await readE01Record(page, record.id)).draft.blocks[0];
  if (beforeMove.kind !== "content" || moved?.kind !== "content")
    throw new Error("Content fixture required");
  const oldHotspot = beforeMove.scene!.nodes.find((node) => node.type === "hotspot")!;
  const newHotspot = moved.scene!.nodes.find((node) => node.type === "hotspot")!;
  if (oldHotspot.type !== "hotspot" || newHotspot.type !== "hotspot")
    throw new Error("Hotspot fixture required");
  expect(newHotspot.frame.width).toBeCloseTo((oldHotspot.frame.width * 34) / 35);
  expect(newHotspot.body).toBe(localBody);
  await clickNativeInsert(page, "Add detail dialog");
  await page
    .getByRole("textbox", { name: "Detail button label", exact: true })
    .fill("Open evidence");
  await page.getByRole("textbox", { name: "Detail title", exact: true }).fill("Evidence details");
  await page.getByRole("textbox", { name: "Detail audience content", exact: true }).fill(localBody);
  await saveGeometry(page, { height: 16, y: 70 });
  await clickNativeInsert(page, "Add reveal panel");
  await page
    .getByRole("textbox", { name: "Reveal panel label", exact: true })
    .fill("Reveal evidence");
  await page
    .getByRole("textbox", { name: "Revealed audience content", exact: true })
    .fill(broadcastBody);
  await page
    .getByRole("combobox", { name: "Reveal audience", exact: true })
    .selectOption("broadcast");
  await saveGeometry(page, { width: 40 });
  await clickNativeInsert(page, "Add slide link");
  await page
    .getByRole("textbox", { name: "Slide link label", exact: true })
    .fill("Follow checkpoint");
  await page
    .getByRole("combobox", { name: "Target slide or activity", exact: true })
    .selectOption(question.id);
  await saveGeometry(page, { height: 10, x: 8, width: 45, y: 88 });
  await selectE01Block(page, question.question.prompt, narrow);
  await page.getByRole("button", { name: "Add answer branch", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Branch 1 label", exact: true })
    .fill("Follow explanation");
  await page
    .getByRole("combobox", { name: "Branch 1 condition", exact: true })
    .selectOption("choice_share");
  await page
    .getByRole("combobox", { name: "Branch 1 answer choice", exact: true })
    .selectOption(question.question.choices[0]!.id);
  await page.getByRole("spinbutton", { name: "Branch 1 minimum percent", exact: true }).fill("100");
  await page
    .getByRole("combobox", { name: "Branch 1 target", exact: true })
    .selectOption(target.id);
  await expect
    .poll(async () => {
      const draft = (await readE01Record(page, record.id)).draft;
      return {
        version: draft.schemaVersion,
        branch: draft.blocks[1]?.kind === "question" ? draft.blocks[1].branches?.[0] : null,
      };
    })
    .toMatchObject({
      version: 13,
      branch: {
        label: "Follow explanation",
        targetBlockId: target.id,
        condition: { kind: "choice_share", minPercent: 100, minResponses: 1 },
      },
    });
  await page.reload();
  const publishing = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/presentations/${record.id}/publish`,
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  expect((await publishing).status()).toBe(200);
  const published = await readE01Record(page, record.id);
  const authored = published.draft.blocks[0]!;
  if (authored.kind !== "content") throw new Error("Opening fixture required");
  const image = authored.scene!.nodes.find((node) => node.type === "image")!;
  const reveal = authored.scene!.nodes.find((node) => node.type === "reveal")!;
  const link = authored.scene!.nodes.find((node) => node.type === "navigation")!;
  if (image.type !== "image" || reveal.type !== "reveal" || link.type !== "navigation")
    throw new Error("Interaction fixture required");
  const created = await page.request.post(`${e01ApiUrl}/v1/presentation-sessions`, {
    data: { presentationId: record.id, timeMode: "flex" },
  });
  expect(created.status()).toBe(201);
  const { snapshot, controlToken } = await created.json();
  const sessionId = snapshot.sessionId as string;
  await page.evaluate(
    ({ sessionId, controlToken }) =>
      sessionStorage.setItem(`openround:presentation-host:${sessionId}`, controlToken),
    { sessionId, controlToken },
  );
  // A newer publication has a different link target; this session must retain the original node target.
  const changed: PresentationDraft = {
    ...published.draft,
    blocks: published.draft.blocks.map((block) =>
      block.id === opening.id && block.kind === "content"
        ? {
            ...block,
            scene: {
              ...block.scene!,
              nodes: block.scene!.nodes.map((node) =>
                node.id === link.id && node.type === "navigation"
                  ? { ...node, targetBlockId: closing.id }
                  : node,
              ),
            },
          }
        : block,
    ),
  };
  const saved = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
    data: {
      draft: changed,
      expectedRevision: published.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  const republished = await page.request.post(
    `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
    { data: { expectedDraftRevision: (await saved.json()).presentation.draftRevision } },
  );
  expect(republished.status()).toBe(200);
  await page.goto(`/presentation-session/${sessionId}/host`);
  const remote = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Launch companion", exact: true }).click();
  const companion = await remote;
  await expect(
    companion.getByRole("button", { name: "Start Presentation", exact: true }),
  ).toBeEnabled();
  const audienceStage = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open audience stage", exact: true }).click();
  const stage = await audienceStage;
  return {
    sessionId,
    code: snapshot.code as string,
    opening,
    question,
    skipped,
    target,
    closing,
    image,
    reveal,
    link,
    companion,
    stage,
  };
}

async function hostSnapshot(page: Page, id: string): Promise<PresentationHostSnapshot> {
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).snapshot;
}
async function publicSnapshot(page: Page, id: string, role: "participant" | "stage") {
  const token = await page.evaluate(
    ({ id, role }) => sessionStorage.getItem(`openround:presentation-${role}:${id}`),
    { id, role },
  );
  const response = await page.request.get(`${e01ApiUrl}/v1/presentation-sessions/${id}/${role}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const snapshot = (await response.json()).snapshot;
  expect(JSON.stringify(snapshot)).not.toMatch(
    /PRIVATE E06|"branches"|"isCorrect"|"speakerNotes"|"presenter"|"sourceCitations"/,
  );
  expect(
    snapshot.interactionState?.reveals.every(
      (entry: { blockId: string }) => entry.blockId === snapshot.currentBlock?.id,
    ) ?? true,
  ).toBe(true);
  return snapshot;
}
async function loseAcknowledgement(page: Page, action: string) {
  const commands: string[] = [];
  let ack: string | null = null;
  let dropped = false;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const match = message.toString().match(/^42(\d+)(\[.*)$/);
      if (match) {
        const [event, command] = JSON.parse(match[2]!);
        if (event === "presentation.command" && command.action === action) {
          commands.push(JSON.stringify(command));
          if (ack === null) ack = match[1]!;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (!dropped && ack !== null && message.toString().startsWith(`43${ack}[`)) {
        dropped = true;
        socket.close({ code: 1012, reason: "E06 accepted acknowledgement lost" });
        return;
      }
      socket.send(message);
    });
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();
  return { commands, dropped: () => dropped };
}

for (const suffix of ["", " @mobile"])
  test(`advanced interactions retain local dialogs, broadcast authority, frozen links and real branch evidence${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const hostCommands: Record<string, unknown>[] = [];
    page.on("websocket", (socket) =>
      socket.on("framesent", ({ payload }) => {
        const match = payload.toString().match(/^42\d+(\[.*)$/);
        if (match) {
          const [event, command] = JSON.parse(match[1]!);
          if (event === "presentation.command") hostCommands.push(command);
        }
      }),
    );
    const f = await createFixture(page, info);
    const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = info.project.use;
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    const guest = await context.newPage();
    const frames: string[] = [];
    guest.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
    );
    try {
      await guest.goto(`/join?code=${f.code}`);
      await guest.getByLabel("Nickname", { exact: true }).fill("E06 genuine browser response");
      await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
      await expect(guest).toHaveURL(`/presentation-session/${f.sessionId}/play`);
      await page.getByRole("button", { name: "Start Presentation", exact: true }).click();
      for (const surface of [page, guest, f.companion, f.stage]) {
        await surface.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
        await expect(
          surface.getByRole("img", { name: "Two workflow steps", exact: true }),
        ).toBeVisible();
        await expect
          .poll(() =>
            surface
              .getByRole("img", { name: "Two workflow steps", exact: true })
              .evaluate((image: HTMLImageElement) => image.naturalWidth),
          )
          .toBe(320);
      }
      for (const [surface, role] of [
        [guest, "participant"],
        [f.stage, "stage"],
      ] as const)
        expect(JSON.stringify(await publicSnapshot(surface, f.sessionId, role))).not.toContain(
          broadcastBody,
        );
      expect(frames.join("\n")).not.toContain(broadcastBody);
      expect(await guest.content()).not.toContain(broadcastBody);
      await expect(guest.getByRole("button", { name: /Follow checkpoint/ })).toBeDisabled();
      await guest.getByRole("button", { name: "Show accessible outline", exact: true }).click();
      const inspect = guest.getByRole("button", { name: /^Inspect / });
      await inspect.focus();
      await inspect.press("Enter");
      const hotspotDialog = guest.getByRole("dialog", { name: "Workflow detail", exact: true });
      await expect(hotspotDialog).toContainText(localBody);
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
      await guest.keyboard.press("Escape");
      await expect(inspect).toBeFocused();
      const remoteDetail = f.companion.getByRole("button", { name: /^Open evidence / });
      await remoteDetail.focus();
      await remoteDetail.press("Enter");
      const remoteDialog = f.companion.getByRole("dialog", {
        name: "Evidence details",
        exact: true,
      });
      await expect(remoteDialog).toContainText(localBody);
      expect((await new AxeBuilder({ page: f.companion }).analyze()).violations).toEqual([]);
      await remoteDialog.screenshot({ path: info.outputPath("e06-companion-detail-dialog.png") });
      await f.companion.keyboard.press("Escape");
      await expect(remoteDetail).toBeFocused();
      const hostDetail = page.getByRole("button", { name: /^Open evidence / });
      await hostDetail.click();
      const hostDialog = page.getByRole("dialog", { name: "Evidence details", exact: true });
      const beforeKeys = (await hostSnapshot(page, f.sessionId)).revision;
      const detailRegion = hostDialog.getByRole("region", {
        name: "Evidence details",
        exact: true,
      });
      await detailRegion.focus();
      for (const key of ["ArrowRight", "PageDown", " "]) await detailRegion.press(key);
      expect((await hostSnapshot(page, f.sessionId)).revision).toBe(beforeKeys);
      await page.keyboard.press("Escape");
      await expect(hostDetail).toBeFocused();
      const transport = await loseAcknowledgement(f.companion, "set_reveal");
      await guest.getByRole("button", { name: /^Open evidence / }).click();
      const localDialog = guest.getByRole("dialog", { name: "Evidence details", exact: true });
      await f.companion
        .getByRole("button", { name: /^Reveal evidence Show for everyone$/ })
        .click();
      await expect.poll(transport.dropped).toBe(true);
      await expect
        .poll(async () =>
          JSON.stringify(await publicSnapshot(guest, f.sessionId, "participant")).includes(
            broadcastBody,
          ),
        )
        .toBe(true);
      await expect(localDialog).toBeVisible();
      await page.getByRole("button", { name: /^Reveal evidence Hide for everyone$/ }).click();
      await expect
        .poll(async () =>
          JSON.stringify(await publicSnapshot(guest, f.sessionId, "participant")).includes(
            broadcastBody,
          ),
        )
        .toBe(false);
      await expect(localDialog).toBeVisible();
      await guest.keyboard.press("Escape");
      await f.companion.reload();
      const retryReveal = f.companion.getByRole("button", {
        name: "Retry broadcast reveal acknowledgement",
        exact: true,
      });
      await expect(retryReveal).toBeEnabled();
      await retryReveal.click();
      await expect(retryReveal).toHaveCount(0);
      expect(transport.commands).toHaveLength(2);
      expect(transport.commands[0]).toBe(transport.commands[1]);
      expect(JSON.parse(transport.commands[0]!)).toMatchObject({
        action: "set_reveal",
        blockId: f.opening.id,
        nodeId: f.reveal.id,
        revealed: true,
      });
      expect(JSON.stringify(await publicSnapshot(guest, f.sessionId, "participant"))).not.toContain(
        broadcastBody,
      );
      await page
        .getByRole("region", { name: "Current slide", exact: true })
        .screenshot({ path: info.outputPath("e06-live-hotspots-and-broadcast.png") });
      await page.getByRole("button", { name: /^Follow checkpoint / }).click();
      await expect(
        guest.getByRole("heading", { name: f.question.question.prompt, exact: true }),
      ).toBeVisible();
      const navigation = hostCommands.find((command) => command.action === "navigate_scene");
      expect(navigation).toMatchObject({ blockId: f.opening.id, nodeId: f.link.id });
      expect(navigation).not.toHaveProperty("targetBlockId");
      await expect(page.getByRole("button", { name: /^Follow explanation / })).toBeDisabled();
      await guest.getByRole("button", { name: "Evidence supported", exact: true }).click();
      await guest.getByRole("button", { name: "Submit response", exact: true }).click();
      await expect(
        guest.getByText("Response saved. You can stay here while the facilitator continues.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Reveal and close question", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Follow explanation / })).toBeEnabled();
      const closed = await hostSnapshot(page, f.sessionId);
      const receipt = (await publicSnapshot(guest, f.sessionId, "participant")).responseReceipt;
      const branchTransport = await loseAcknowledgement(page, "follow_branch");
      await page.getByRole("button", { name: /^Follow explanation / }).click();
      await expect.poll(branchTransport.dropped).toBe(true);
      await expect(f.companion.getByRole("heading", { name: /Branch target/ })).toBeVisible();
      await f.companion.getByRole("button", { name: "Next block", exact: true }).click();
      await page.reload();
      const retryBranch = page.getByRole("button", {
        name: "Retry branch acknowledgement",
        exact: true,
      });
      await expect(retryBranch).toBeEnabled();
      await retryBranch.click();
      await expect(retryBranch).toHaveCount(0);
      expect(branchTransport.commands).toHaveLength(2);
      expect(branchTransport.commands[0]).toBe(branchTransport.commands[1]);
      await expect(page.getByRole("region", { name: "Current slide", exact: true })).toContainText(
        "Advanced closing",
      );
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      let map = page.getByRole("dialog", { name: "Presentation navigation", exact: true });
      await map
        .getByRole("list")
        .getByRole("button", { name: new RegExp(f.question.question.prompt) })
        .click();
      await expect(map).not.toBeVisible();
      const reviewed = await hostSnapshot(page, f.sessionId);
      expect(reviewed.phase).toBe("question_reveal");
      expect(reviewed.responseCount).toBe(1);
      expect(reviewed.participants.map(({ score }) => score)).toEqual(
        closed.participants.map(({ score }) => score),
      );
      expect((await publicSnapshot(guest, f.sessionId, "participant")).responseReceipt).toEqual(
        receipt,
      );
      await expect(guest.getByRole("button", { name: "Submit response", exact: true })).toHaveCount(
        0,
      );
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      map = page.getByRole("dialog", { name: "Presentation navigation", exact: true });
      await map
        .getByRole("list")
        .getByRole("button", { name: /Advanced closing/ })
        .click();
      await expect(map).not.toBeVisible();
      await page.getByRole("button", { name: "Finish Presentation", exact: true }).click();
      const uri = `${e01ApiUrl}/v1/presentation-sessions/${f.sessionId}/report?includeNavigation=true&includeInteractions=true&includeQuickChecks=true&includeOpinionResults=true&includeTextResults=true`;
      await expect
        .poll(async () => (await (await page.request.get(uri)).json()).reportStatus)
        .toBe("ready");
      const report = (await (await page.request.get(uri)).json()).report;
      expect(report.schemaVersion).toBe(7);
      expect(report.interactionSummary).toEqual({ revealChangeCount: 2, branchCount: 1 });
      expect(report.responseCount).toBe(1);
      expect(
        report.evidence.find((entry: { blockId: string }) => entry.blockId === f.question.id),
      ).toMatchObject({ respondents: 1, totalScore: 100 });
      expect(
        report.navigation.blocks.find(
          (entry: { blockId: string }) => entry.blockId === f.skipped.id,
        ),
      ).toMatchObject({ status: "skipped", phase: null });
      expect(frames.join("\n")).not.toMatch(
        /PRIVATE E06|"branches"|"isCorrect"|"speakerNotes"|"presenter"|"sourceCitations"/,
      );
      await page.goto(`/presentation-session/${f.sessionId}/report`);
      await expect(
        page.getByText("2 broadcast reveal changes · 1 answer branches followed", { exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath("e06-advanced-interaction-report.png"),
        fullPage: true,
      });
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export evidence CSV", exact: true }).click();
      const download = await downloading;
      const csvPath = await download.path();
      if (!csvPath) throw new Error("CSV download required");
      const csv = await readFile(csvPath, "utf8");
      expect(csv).toContain('"broadcast_reveal_change_count","answer_branch_count"');
      expect(csv).toContain('"section_id","section_title","presentation_status"');
    } finally {
      await context.close();
      await f.companion.close();
      await f.stage.close();
    }
  });

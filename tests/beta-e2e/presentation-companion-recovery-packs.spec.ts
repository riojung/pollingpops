import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { signInBeta } from "./sign-in";

const apiUrl = `http://127.0.0.1:${Number(process.env.BETA_E2E_API_PORT ?? 4200)}`;

async function packFixture(page: Page) {
  await signInBeta(page);
  const suffix = randomUUID().slice(0, 8);
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "single_select",
    prompt,
    purpose: "diagnostic",
    confidence: "off",
    delivery: "main",
    conceptKeys: ["synthetic"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 120,
    basePoints: 100,
    explanation: `Hidden checkpoint rationale ${suffix}`,
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Observed evidence", isCorrect: true },
      { id: randomUUID(), label: "Unsupported assumption", isCorrect: false },
    ],
  });
  const diagnostic = question(`Companion diagnostic ${suffix}`);
  const recheck = { ...question(`Companion transfer ${suffix}`), delivery: "recheck" };
  diagnostic.linkedRecheckQuestionId = recheck.id;
  const body = `Frozen companion guidance ${suffix}.`;
  const unselectedBody = `Unselected companion guidance ${suffix}.`;
  const createdPack = await page.request.post(`${apiUrl}/v1/recovery-packs`, {
    data: {
      draft: {
        schemaVersion: 1,
        title: `Companion published Pack ${suffix}`,
        description: "Synthetic live insertion coverage",
        diagnostic,
        recheck,
        interventions: [
          { id: randomUUID(), title: "Compare the evidence", body, citations: [] },
          {
            id: randomUUID(),
            title: "Alternative explanation",
            body: unselectedBody,
            citations: [],
          },
        ],
        delayedProbe: null,
        conceptKeys: ["synthetic"],
        misconceptionKeys: [],
        citations: [],
      },
    },
  });
  expect(createdPack.status()).toBe(201);
  const pack = (await createdPack.json()).pack;
  const publishedPack = await page.request.post(`${apiUrl}/v1/recovery-packs/${pack.id}/publish`, {
    data: { expectedDraftRevision: pack.draftRevision },
  });
  expect(publishedPack.status()).toBe(200);
  const version = (await publishedPack.json()).version;
  const createdPresentation = await page.request.post(`${apiUrl}/v1/presentations`, {
    data: { title: `Companion destination ${suffix}`, description: "" },
  });
  expect(createdPresentation.status()).toBe(201);
  let presentation = (await createdPresentation.json()).presentation;
  const blocks = [
    { id: randomUUID(), kind: "question", question: question(`Deck check ${suffix}`) },
  ];
  const saved = await page.request.put(`${apiUrl}/v1/presentations/${presentation.id}/draft`, {
    data: {
      draft: { ...presentation.draft, blocks },
      expectedRevision: presentation.draftRevision,
      mutationId: randomUUID(),
      schemaVersion: 2,
    },
  });
  expect(saved.status()).toBe(200);
  presentation = (await saved.json()).presentation;
  const published = await page.request.post(
    `${apiUrl}/v1/presentations/${presentation.id}/publish`,
    {
      data: { expectedDraftRevision: presentation.draftRevision },
    },
  );
  expect(published.status()).toBe(200);
  const createdSession = await page.request.post(`${apiUrl}/v1/presentation-sessions`, {
    data: { presentationId: presentation.id },
  });
  expect(createdSession.status()).toBe(201);
  const { snapshot, controlToken } = await createdSession.json();
  await page.evaluate(
    ({ id, token }) => sessionStorage.setItem(`openround:presentation-host:${id}`, token),
    { id: snapshot.sessionId, token: controlToken },
  );
  return {
    pack,
    version,
    presentation,
    blocks: presentation.draft.blocks,
    diagnostic,
    recheck,
    body,
    unselectedBody,
    snapshot,
  };
}

async function packWorkflow(page: Page, browser: Browser, testInfo: TestInfo) {
  test.setTimeout(120_000);
  const fixture = await packFixture(page);
  const sessionId = fixture.snapshot.sessionId;
  await page.goto(`/presentation-session/${sessionId}/host`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Launch companion", exact: true }).click();
  const companion = await popup;
  await expect(companion.getByRole("heading", { name: "Presentation Companion" })).toBeVisible();
  const readPass = () =>
    companion.evaluate(
      (id) => sessionStorage.getItem(`openround:presentation-companion:${id}`),
      sessionId,
    );
  // The server-rendered heading can appear before hydration captures the launch pass.
  await expect
    .poll(async () => Boolean(await readPass()), {
      message: "The companion launch credential is persisted before recovery actions",
    })
    .toBe(true);
  const pass = await readPass();
  expect(pass).toBeTruthy();
  const scopedRequests: Array<Promise<Record<string, string>>> = [];
  companion.on("request", (request) => {
    if (new URL(request.url()).pathname.includes(`/presentation-sessions/${sessionId}/companion`))
      scopedRequests.push(request.allHeaders());
  });
  const frames: string[] = [];
  companion.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => frames.push(payload.toString())),
  );
  let dropped = false;
  let ackId: string | null = null;
  const insertCommands: string[] = [];
  await companion.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const match = message.toString().match(/^42(\d+)(\[.*)$/);
      if (match) {
        const [event, command] = JSON.parse(match[2]!);
        if (event === "presentation.command" && command.action === "insert_recovery_pack") {
          insertCommands.push(JSON.stringify(command));
          if (ackId === null) ackId = match[1]!;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (!dropped && ackId !== null && message.toString().startsWith(`43${ackId}[`)) {
        dropped = true;
        return;
      }
      socket.send(message);
    });
  });
  await companion.reload();
  await expect(companion.getByRole("status").filter({ hasText: /^Connected$/ })).toBeVisible();

  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const guestContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    reducedMotion: "reduce",
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/join?code=${fixture.snapshot.code}`);
    await guest.getByLabel("Nickname", { exact: true }).fill("Synthetic guest");
    await guest.getByRole("button", { name: "Join a Presentation", exact: true }).click();
    await expect(guest).toHaveURL(`/presentation-session/${sessionId}/play`);
    const open = companion.getByRole("button", { name: "Add Recovery Pack", exact: true });
    await expect(open).toBeEnabled();
    await open.focus();
    await open.press("Enter");
    const dialog = companion.getByRole("dialog", { name: "Published Recovery Packs", exact: true });
    await expect(dialog).toBeVisible();
    await expect(
      companion.getByRole("option", { name: new RegExp(fixture.pack.title) }),
    ).toBeAttached();
    expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
    await companion.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(open).toBeFocused();
    await open.click();
    await companion
      .getByLabel("Published Recovery Pack", { exact: true })
      .selectOption(fixture.version.id);
    const catalog = await companion.request.get(
      `${apiUrl}/v1/presentation-sessions/${sessionId}/companion-recovery-packs`,
      { headers: { authorization: `Bearer ${pass}` } },
    );
    expect(catalog.status()).toBe(200);
    const metadata = await catalog.json();
    for (const pack of metadata.packs)
      expect(Object.keys(pack).sort()).toEqual(["packId", "packVersion", "packVersionId", "title"]);
    expect(JSON.stringify(metadata)).not.toContain(fixture.diagnostic.prompt);
    expect(JSON.stringify(metadata)).not.toContain(fixture.body);

    // The selected immutable version must not silently upgrade when its source changes.
    const laterBody = "Later published guidance must not replace the selected snapshot.";
    const sourceSaved = await page.request.put(
      `${apiUrl}/v1/recovery-packs/${fixture.pack.id}/draft`,
      {
        data: {
          draft: {
            ...fixture.pack.draft,
            interventions: [
              { ...fixture.pack.draft.interventions[0], body: laterBody },
              fixture.pack.draft.interventions[1],
            ],
          },
          expectedRevision: fixture.pack.draftRevision,
          mutationId: randomUUID(),
        },
      },
    );
    expect(sourceSaved.status()).toBe(200);
    expect(
      (
        await page.request.post(`${apiUrl}/v1/recovery-packs/${fixture.pack.id}/publish`, {
          data: { expectedDraftRevision: (await sourceSaved.json()).pack.draftRevision },
        })
      ).status(),
    ).toBe(200);
    await companion.getByRole("button", { name: "Insert and start Pack", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: fixture.diagnostic.prompt, exact: true }),
    ).toBeVisible();
    const retry = dialog.getByRole("button", {
      name: "Retry Pack insertion acknowledgement",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    expect(dropped).toBe(true);
    expect(insertCommands).toHaveLength(1);
    expect(
      (await page.request.delete(`${apiUrl}/v1/recovery-packs/${fixture.pack.id}`)).status(),
    ).toBe(204);
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(insertCommands).toHaveLength(2);
    expect(insertCommands[0]).toBe(insertCommands[1]);
    await expect(dialog).not.toBeVisible();
    await expect(
      companion.getByRole("button", { name: "Add Recovery Pack", exact: true }),
    ).toBeDisabled();
    const beforeReveal = await companion.request.get(
      `${apiUrl}/v1/presentation-sessions/${sessionId}/companion`,
      {
        headers: { authorization: `Bearer ${pass}` },
      },
    );
    const openSnapshot = (await beforeReveal.json()).snapshot;
    expect(openSnapshot.blockCount).toBe(3);
    expect(openSnapshot.recoveryPackCards).toBeUndefined();
    expect(openSnapshot.canInsertRecoveryPack).toBe(false);
    for (const hidden of [
      "isCorrect",
      fixture.body,
      fixture.unselectedBody,
      fixture.recheck.prompt,
      fixture.diagnostic.explanation,
    ])
      expect(frames.some((frame) => frame.includes(hidden))).toBe(false);
    await guest.getByRole("button", { name: "Unsupported assumption", exact: true }).click();
    await guest.getByRole("button", { name: "Submit response", exact: true }).click();
    await expect(
      guest.getByText("Response saved. You can stay here while the facilitator continues."),
    ).toBeVisible();
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    const chooser = companion.getByLabel("Recovery Pack card", { exact: true });
    await expect(chooser).toBeVisible();
    await expect(
      companion.getByRole("button", { name: "Add Recovery Pack", exact: true }),
    ).toBeDisabled();
    const revealed = await companion.request.get(
      `${apiUrl}/v1/presentation-sessions/${sessionId}/companion`,
      {
        headers: { authorization: `Bearer ${pass}` },
      },
    );
    const revealedSnapshot = (await revealed.json()).snapshot;
    for (const card of revealedSnapshot.recoveryPackCards)
      expect(Object.keys(card).sort()).toEqual(["reference", "title"]);
    expect(JSON.stringify(revealedSnapshot)).not.toContain(fixture.body);
    const selectedCard = revealedSnapshot.recoveryPackCards.find(
      (card: { title: string }) => card.title === "Compare the evidence",
    );
    await chooser.selectOption(
      `${selectedCard.reference.insertionId}:${selectedCard.reference.cardId}`,
    );
    await companion
      .getByRole("button", { name: "Work an example with selected card", exact: true })
      .click();
    await expect(
      companion.getByRole("region", { name: "Active Recovery Pack card" }),
    ).toContainText(fixture.body);
    await expect(guest.getByRole("region", { name: "Active Recovery Pack card" })).toContainText(
      fixture.body,
    );
    expect(await companion.locator("body").innerText()).not.toContain(fixture.unselectedBody);
    expect(await companion.locator("body").innerText()).not.toContain(laterBody);
    expect((await new AxeBuilder({ page: companion }).analyze()).violations).toEqual([]);
    expect(await companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await companion.reload();
    await expect(
      companion.getByRole("region", { name: "Active Recovery Pack card" }),
    ).toContainText(fixture.body);
    await companion.getByRole("button", { name: "Continue to recheck", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: fixture.recheck.prompt, exact: true }),
    ).toBeVisible();
    await expect(companion.getByRole("region", { name: "Active Recovery Pack card" })).toHaveCount(
      0,
    );
    await guest.getByRole("button", { name: "Observed evidence", exact: true }).click();
    await guest.getByRole("button", { name: "Submit response", exact: true }).click();
    await expect(
      guest.getByText("Response saved. You can stay here while the facilitator continues."),
    ).toBeVisible();
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await expect(
      companion.getByRole("button", { name: "Add Recovery Pack", exact: true }),
    ).toBeEnabled();
    await companion.getByRole("button", { name: "Continue Presentation", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: fixture.blocks[0]!.question.prompt, exact: true }),
    ).toBeVisible();
    await companion.getByRole("button", { name: "Reveal and close question", exact: true }).click();
    await companion.getByRole("button", { name: "Continue Presentation", exact: true }).click();
    await expect(
      companion.getByRole("button", { name: "Presentation finished", exact: true }),
    ).toBeDisabled();
    const unchanged = await page.request.get(
      `${apiUrl}/v1/presentations/${fixture.presentation.id}`,
    );
    const retained = (await unchanged.json()).presentation;
    expect(retained.draft.blocks).toEqual(fixture.blocks);
    expect(retained.draftRevision).toBe(fixture.presentation.draftRevision);
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${apiUrl}/v1/presentation-sessions/${sessionId}/report`,
        );
        return (await response.json()).report?.recovery?.[0]?.recovered;
      })
      .toBe(1);
    const headers = await Promise.all(scopedRequests);
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((request) => !request.cookie)).toBe(true);
  } finally {
    await guestContext.close();
    await companion.close();
  }
}

test("Companion Pack insertion recovers acknowledgement and plays a frozen recovery loop", async ({
  page,
  browser,
}, testInfo) => {
  await packWorkflow(page, browser, testInfo);
});
test("Companion Pack picker and playback stay accessible and private @mobile", async ({
  page,
  browser,
}, testInfo) => {
  await packWorkflow(page, browser, testInfo);
});

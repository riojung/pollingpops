import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  PresentationReviewFeedbackAccessSchema,
  PresentationReviewFeedbackSchema,
  PresentationReviewSchema,
} from "../../packages/contracts/src/index.ts";
import {
  createE01Deck,
  e01ApiUrl,
  e01Slide,
  enterE01Editor,
  readE01Record,
} from "./presentation-e01-support";
import { signInBeta } from "./sign-in";

test.use({ actionTimeout: 30_000 });
const privateMarker = "PRIVATE_E11_NOTES_AND_SOURCE";
const hiddenMarker = "HIDDEN_E11_PLANNING_PAGE";
const authorPath = (id: string, shareId: string) =>
  `${e01ApiUrl}/v1/presentations/${id}/shares/${shareId}/feedback`;
const recipientPath = (shareId: string) =>
  `${e01ApiUrl}/v1/shared-presentations/${shareId}/feedback`;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function authorFeedback(page: Page, id: string, shareId: string) {
  const response = await page.request.get(authorPath(id, shareId));
  expect(response.status()).toBe(200);
  return PresentationReviewFeedbackSchema.parse(await response.json());
}
async function reviewerFeedback(page: Page, shareId: string, token: string) {
  const response = await page.request.get(recipientPath(shareId), { headers: bearer(token) });
  expect(response.status()).toBe(200);
  const value = await response.json();
  for (const marker of [privateMarker, hiddenMarker, '"email"', '"actorId"', '"userId"'])
    expect(JSON.stringify(value)).not.toContain(marker);
  return PresentationReviewFeedbackSchema.parse(value);
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}
async function preserveDraftsAcrossFocus(
  page: Page,
  shareId: string,
  checkDrafts: () => Promise<void>,
  responseStatus = 200,
) {
  const path = `${e01ApiUrl}/v1/shared-presentations/${shareId}`;
  let started = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = async (route: Route) => {
    started = true;
    await gate;
    if (responseStatus === 503)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "DEPENDENCY_UNAVAILABLE", message: "Retry review" },
        }),
      });
    else await route.continue();
  };
  await page.route(path, handler);
  const response = page
    .waitForResponse((value) => value.url() === path && value.request().method() === "GET")
    .catch(() => null);
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => started).toBe(true);
    await checkDrafts();
  } finally {
    release();
    await response;
    await page.unroute(path, handler);
  }
  await checkDrafts();
}

for (const suffix of ["", " @mobile"]) {
  test(`private feedback preserves review identity, exact retries and version approval${suffix}`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await signInBeta(page);
    const run = randomUUID().slice(0, 8);
    const opening = e01Slide(`Review opening ${run}`);
    opening.speakerNotes = privateMarker;
    opening.citations = [{ locator: privateMarker, excerpt: privateMarker }];
    const hidden = { ...e01Slide(hiddenMarker), hidden: true as const };
    const closing = e01Slide(`Review closing ${run}`);
    const record = await createE01Deck(page, [opening, hidden, closing], 14);
    const publish = await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/publish`, {
      data: { expectedDraftRevision: record.draftRevision },
    });
    expect(publish.status()).toBe(200);
    const versionId = (await publish.json()).version.id as string;
    const token = randomBytes(32).toString("base64url");
    const created = await page.request.post(`${e01ApiUrl}/v1/presentations/${record.id}/shares`, {
      data: {
        requestId: randomUUID(),
        versionId,
        token,
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
    });
    expect(created.status()).toBe(201);
    const shareId = (await created.json()).share.id as string;
    const reviewPath = `/presentation-review/${shareId}`;
    const narrow = (info.project.use.viewport?.width ?? 1280) <= 700;
    // Local HTTP origins may expose getRandomValues without randomUUID. Exercise the
    // same existing clientUuid fallback for author and reviewer feedback actions.
    const withoutRandomUuid = () =>
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: undefined,
      });
    await page.addInitScript(withoutRandomUuid);
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: info.project.use.viewport ?? { width: 1280, height: 720 },
      isMobile: narrow,
      hasTouch: narrow,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    await context.addInitScript(withoutRandomUuid);
    const reviewer = await context.newPage();
    try {
      const oldView = await reviewer.request.get(
        `${e01ApiUrl}/v1/shared-presentations/${shareId}`,
        {
          headers: bearer(token),
        },
      );
      expect(oldView.status()).toBe(200);
      const frozenView = PresentationReviewSchema.parse(await oldView.json());
      expect(frozenView.blocks.map((block) => block.id)).toEqual([opening.id, closing.id]);
      expect(JSON.stringify(frozenView)).not.toContain(privateMarker);
      expect(JSON.stringify(frozenView)).not.toContain(hiddenMarker);
      const before = await reviewer.request.get(`${recipientPath(shareId)}/access`, {
        headers: bearer(token),
      });
      expect(before.status()).toBe(200);
      expect(PresentationReviewFeedbackAccessSchema.parse(await before.json()).enabled).toBe(false);
      await reviewer.goto(`${reviewPath}#token=${token}`);
      await expect(reviewer).toHaveURL((url) => url.pathname === reviewPath && !url.hash);
      await expect(
        reviewer.getByRole("link", { name: "Sign in to comment", exact: true }),
      ).toHaveCount(0);

      await enterE01Editor(page, record.id, narrow);
      await page.getByRole("button", { name: "Share review link", exact: true }).click();
      const sharing = page.getByRole("dialog", {
        name: "Share a private review link",
        exact: true,
      });
      await sharing.getByRole("button", { name: "Review feedback", exact: true }).click();
      const author = sharing.getByRole("region", { name: "Author review feedback", exact: true });
      await author.getByRole("button", { name: "Enable comments", exact: true }).click();
      await expect
        .poll(async () => (await authorFeedback(page, record.id, shareId)).status)
        .toBe("open");
      await reviewer.reload();
      const signin = reviewer.getByRole("link", { name: "Sign in to comment", exact: true });
      await expect(signin).toBeVisible();
      const signinUrl = new URL((await signin.getAttribute("href"))!, reviewer.url());
      expect(signinUrl.pathname).toBe("/signin");
      expect(signinUrl.searchParams.get("returnTo")).toBe(reviewPath);
      expect(signinUrl.href).not.toContain(token);
      await signin.click();
      await signInBeta(reviewer, `e11-reviewer-${run}@example.test`, { returnTo: reviewPath });
      await expect(reviewer).toHaveURL((url) => url.pathname === reviewPath && !url.hash);
      const feedback = reviewer.getByRole("region", {
        name: "Presentation review feedback",
        exact: true,
      });
      const first = await reviewerFeedback(reviewer, shareId, token);
      expect(first.capabilities).toMatchObject({ comment: true, resolve: false, approve: false });
      expect(first.threads).toEqual([]);

      const composer = feedback.getByRole("textbox", {
        name: "Comment on this page",
        exact: true,
      });
      await composer.fill("An abandoned opening draft");
      await composer.fill("");
      await reviewer.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(
        reviewer.getByRole("region", { name: "Current presentation page", exact: true }),
      ).toContainText("Page 2 of 2");
      await composer.fill("A new comment on the current page");
      await expect(feedback).toContainText("Commenting on published page 2, version 1.");
      await composer.fill("");
      await reviewer.getByRole("button", { name: "Previous page", exact: true }).click();
      await expect(
        reviewer.getByRole("region", { name: "Current presentation page", exact: true }),
      ).toContainText("Page 1 of 2");
      const wording = `Clarify this opening ${run}`;
      await composer.fill(wording);
      await reviewer.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(feedback).toContainText("Commenting on published page 1, version 1.");
      await expect(
        reviewer.getByRole("region", { name: "Current presentation page", exact: true }),
      ).toContainText(
        closing.scene!.nodes[0]!.type === "text" ? closing.scene!.nodes[0]!.text : "",
      );
      const sent: unknown[] = [];
      let dropped = false;
      await reviewer.route(`${recipientPath(shareId)}/commands`, async (route) => {
        sent.push(route.request().postDataJSON());
        if (!dropped) {
          dropped = true;
          const accepted = await route.fetch();
          expect(accepted.status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      });
      await feedback.getByRole("button", { name: "Post comment", exact: true }).click();
      await expect(
        feedback.getByRole("button", { name: "Retry pending action", exact: true }),
      ).toBeVisible();
      await reviewer.reload();
      await reviewer
        .getByRole("region", { name: "Presentation review feedback", exact: true })
        .getByRole("button", { name: "Retry pending action", exact: true })
        .click();
      await expect.poll(() => sent.length).toBe(2);
      expect(sent[1]).toEqual(sent[0]);
      await reviewer.unroute(`${recipientPath(shareId)}/commands`);
      const accepted = await reviewerFeedback(reviewer, shareId, token);
      expect(accepted.threads).toHaveLength(1);
      expect(accepted.threads[0]).toMatchObject({ blockId: opening.id, resolved: false });
      expect(accepted.threads[0]!.messages).toHaveLength(1);
      expect(accepted.threads[0]!.messages[0]).toMatchObject({
        text: wording,
        authorRole: "reviewer",
        authorLabel: "Reviewer 1",
        isOwn: true,
      });

      const discussion = feedback
        .getByRole("article", { name: "Review thread", exact: true })
        .filter({ hasText: wording });
      const replyDraft = discussion.getByRole("textbox", {
        name: "Reply to this thread",
        exact: true,
      });
      const replyText = `Unsent reply ${run}`;
      const editText = `Unsent edit ${run}`;
      await replyDraft.fill(replyText);
      await discussion.getByRole("button", { name: "Edit", exact: true }).click();
      const editDraft = discussion.getByRole("textbox", { name: "Edit comment", exact: true });
      await editDraft.fill(editText);
      const replyNode = await replyDraft.elementHandle();
      const editNode = await editDraft.elementHandle();
      const checkDrafts = async () => {
        await expect(replyDraft).toHaveValue(replyText);
        await expect(editDraft).toHaveValue(editText);
        expect(await replyNode!.evaluate((element) => element.isConnected)).toBe(true);
        expect(await editNode!.evaluate((element) => element.isConnected)).toBe(true);
      };
      await preserveDraftsAcrossFocus(reviewer, shareId, checkDrafts);
      await preserveDraftsAcrossFocus(reviewer, shareId, checkDrafts, 503);
      expect((await reviewerFeedback(reviewer, shareId, token)).threads[0]!.messages).toHaveLength(
        1,
      );
      // A cookie can change in another tab without this document receiving an auth event.
      // A fresh viewer identity must discard discussion-local drafts even when the
      // unchanged publication remains mounted during focus revalidation.
      const reviewerCookies = (await context.cookies()).filter(
        (cookie) => cookie.name === "openround_creator",
      );
      const ownerCookies = (await page.context().cookies()).filter(
        (cookie) => cookie.name === "openround_creator",
      );
      expect(reviewerCookies.length).toBe(1);
      expect(ownerCookies.length).toBe(1);
      await context.addCookies(ownerCookies);
      await reviewer.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(discussion.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
      await expect(editDraft).toHaveCount(0);
      await expect(replyDraft).toHaveValue("");
      expect(await replyNode!.evaluate((element) => element.isConnected)).toBe(false);
      expect(await editNode!.evaluate((element) => element.isConnected)).toBe(false);
      await context.addCookies(reviewerCookies);
      await reviewer.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(discussion.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
      await expect(editDraft).toHaveCount(0);
      await expect(replyDraft).toHaveValue("");

      await author.getByRole("button", { name: "Refresh feedback", exact: true }).click();
      await expect(author).toContainText(wording);
      const approve = author.getByRole("button", { name: "Approve this review", exact: true });
      await expect(approve).toBeDisabled();
      await author.getByRole("button", { name: "Resolve", exact: true }).click();
      await expect(approve).toBeEnabled();
      await feedback.getByRole("button", { name: "Refresh feedback", exact: true }).click();
      await expect(discussion).toContainText("Resolved");
      await expect(
        discussion.getByRole("textbox", { name: "Reply to this thread", exact: true }),
      ).toHaveCount(0);
      await expect(discussion.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
      await expect(discussion).toContainText(/author.*reopen/i);
      await approve.click();
      await expect
        .poll(async () => (await authorFeedback(page, record.id, shareId)).approval.state)
        .toBe("approved");
      expect((await readE01Record(page, record.id)).draftRevision).toBe(record.draftRevision);

      const late = `One more review point ${run}`;
      await feedback.getByRole("textbox", { name: "Comment on this page", exact: true }).fill(late);
      await feedback.getByRole("button", { name: "Post comment", exact: true }).click();
      await expect
        .poll(async () => (await authorFeedback(page, record.id, shareId)).approval.state)
        .toBe("stale");
      await author.getByRole("button", { name: "Refresh feedback", exact: true }).click();
      await expect(author).toContainText(late);
      await author.getByRole("button", { name: "Reopen", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await authorFeedback(page, record.id, shareId)).threads.filter(
              (thread) => !thread.resolved,
            ).length,
        )
        .toBe(2);
      await feedback.getByRole("button", { name: "Refresh feedback", exact: true }).click();
      await expect(discussion).toContainText("Open");
      const reopenedReply = `Reply after reopening ${run}`;
      await replyDraft.fill(reopenedReply);
      await discussion.getByRole("button", { name: "Reply", exact: true }).click();
      await expect(discussion).toContainText(reopenedReply);
      await expect(replyDraft).toHaveValue("");

      const snapshot = await reviewerFeedback(reviewer, shareId, token);
      const wrongIdentity = await reviewer.request.post(`${recipientPath(shareId)}/commands`, {
        headers: bearer(token),
        data: {
          schemaVersion: 1,
          operationId: randomUUID(),
          versionId,
          viewerKey: "0".repeat(64),
          command: {
            type: "thread.create",
            threadId: randomUUID(),
            messageId: randomUUID(),
            blockId: opening.id,
            text: "Rejected identity",
          },
        },
      });
      expect([403, 404, 409, 422]).toContain(wrongIdentity.status());
      expect((await reviewerFeedback(reviewer, shareId, token)).reviewSeq).toBe(snapshot.reviewSeq);

      const current = await readE01Record(page, record.id);
      const later = await page.request.put(`${e01ApiUrl}/v1/presentations/${record.id}/draft`, {
        data: {
          schemaVersion: 2,
          mutationId: randomUUID(),
          expectedRevision: current.draftRevision,
          draft: {
            ...current.draft,
            title: `Later unpublished review ${run}`,
            blocks: [...current.draft.blocks, e01Slide("A later page")],
          },
        },
      });
      expect(later.status()).toBe(200);
      const updated = (await later.json()).presentation;
      const nextPublish = await page.request.post(
        `${e01ApiUrl}/v1/presentations/${record.id}/publish`,
        {
          data: { expectedDraftRevision: updated.draftRevision },
        },
      );
      expect(nextPublish.status()).toBe(200);
      expect((await nextPublish.json()).version.id).not.toBe(versionId);
      expect((await authorFeedback(page, record.id, shareId)).versionId).toBe(versionId);
      const stillFrozen = await reviewer.request.get(
        `${e01ApiUrl}/v1/shared-presentations/${shareId}`,
        { headers: bearer(token) },
      );
      expect(PresentationReviewSchema.parse(await stillFrozen.json())).toEqual(frozenView);

      await reviewer.setViewportSize({ width: 320, height: 760 });
      await noOverflow(reviewer);
      expect((await new AxeBuilder({ page: reviewer }).analyze()).violations).toEqual([]);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await reviewer.screenshot({
        path: info.outputPath("e11-review-feedback-320.png"),
        fullPage: true,
      });
      await sharing.screenshot({ path: info.outputPath("e11-author-review.png") });

      const revoke = await page.request.delete(
        `${e01ApiUrl}/v1/presentations/${record.id}/shares/${shareId}`,
      );
      expect(revoke.status()).toBe(204);
      await feedback.getByRole("button", { name: "Refresh feedback", exact: true }).click();
      await expect(
        reviewer.getByRole("region", { name: "Current presentation page", exact: true }),
      ).toHaveCount(0);
      await expect(reviewer.getByText(wording, { exact: true })).toHaveCount(0);
      expect(
        await reviewer.evaluate(
          (id) => sessionStorage.getItem(`openround:presentation-review:${id}`),
          shareId,
        ),
      ).toBeNull();
      const retained = await authorFeedback(page, record.id, shareId);
      expect(retained.status).toBe("closed");
      expect(retained.capabilities).toMatchObject({
        comment: false,
        resolve: false,
        approve: false,
      });
      expect(retained.threads).toHaveLength(2);
    } finally {
      await context.close();
    }
  });
}

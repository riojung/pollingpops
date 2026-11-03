import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { api, newTeamCanvas, openPresentation, organization, teammate } from "./support";

for (const prefix of ["", "@mobile "]) {
  test(`${prefix}Escape stops following from the compact menu without stopping the presenter`, async ({
    page: owner,
    browser,
  }, testInfo) => {
    const { organizationId } = await organization(owner, testInfo);
    const viewer = await teammate(owner, browser, organizationId, testInfo);
    try {
      await viewer.page.setViewportSize(owner.viewportSize()!);
      const id = await newTeamCanvas(owner);
      const invitation = await owner.request.post(`${api}/v1/canvas-boards/${id}/invitations`, {
        data: { email: viewer.email, role: "viewer", operationId: randomUUID() },
      });
      expect(invitation.status(), await invitation.text()).toBe(201);
      const accepted = await viewer.page.request.post(
        `${api}/v1/canvas-boards/invitations/${(await invitation.json()).invitation.id}/accept`,
        { data: {} },
      );
      expect(accepted.status(), await accepted.text()).toBe(200);
      await viewer.page.goto(`/canvas/${id}`);
      await openPresentation(owner);
      await owner.getByRole("button", { name: "Present my view", exact: true }).click();
      await expect(
        owner.getByRole("status").filter({ hasText: /^You are presenting$/ }),
      ).toBeVisible();
      await viewer.page.bringToFront();
      await openPresentation(viewer.page);
      const follow = viewer.page.getByRole("button", { name: "Follow presenter", exact: true });
      await follow.click();
      const stop = viewer.page.getByRole("button", { name: "Stop following", exact: true });
      await expect(stop).toHaveAttribute("aria-pressed", "true");
      const presentation = viewer.page.getByRole("button", { name: "Presentation", exact: true });
      await expect(presentation).toHaveAttribute("aria-expanded", "true");
      await stop.focus();
      await stop.press("Escape");
      await expect(presentation).toHaveAttribute("aria-expanded", "false");
      await expect(presentation).toBeFocused();
      await openPresentation(viewer.page);
      await expect(follow).toHaveAttribute("aria-pressed", "false");
      await expect(stop).toHaveCount(0);

      const viewport = viewer.page.getByTestId("canvas-surface").locator(":scope > g[transform]");
      const stoppedView = await viewport.getAttribute("transform");
      const before = (
        await (await owner.request.get(`${api}/v1/canvas-boards/${id}/presenter`)).json()
      ).presenter;
      expect(before.active).toBe(true);
      const nextCue = viewer.page.waitForResponse(async (response) => {
        if (!response.url().endsWith(`/v1/canvas-boards/${id}/presenter`) || !response.ok())
          return false;
        const next = (await response.json()).presenter;
        return (
          next.active &&
          next.sessionId === before.sessionId &&
          next.viewport?.width !== before.viewport.width
        );
      });
      await owner.getByRole("button", { name: "Canvas zoom +", exact: true }).click();
      await nextCue;
      await expect(viewport).toHaveAttribute("transform", stoppedView!);
      await expect(follow).toHaveAttribute("aria-pressed", "false");
      const after = (
        await (await owner.request.get(`${api}/v1/canvas-boards/${id}/presenter`)).json()
      ).presenter;
      expect(after.active).toBe(true);
      expect(after.sessionId).toBe(before.sessionId);
    } finally {
      await viewer.context.close();
    }
  });
}

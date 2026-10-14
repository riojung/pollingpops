import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Response,
} from "@playwright/test";

// Multi-browser journeys share one loopback address. Respect production's join
// rate window rather than changing the product limit for these synthetic guests.
async function waitForJoinWindow(response: APIResponse | Response) {
  const seconds = Number(response.headers()["retry-after"] ?? 60);
  const waitSeconds = Number.isFinite(seconds) ? seconds : 60;
  await delay(Math.min(60_000, Math.max(1_000, Math.ceil(waitSeconds * 1_000))));
}

export async function joinBetaParticipant(
  request: APIRequestContext,
  apiUrl: string,
  data: Record<string, unknown>,
) {
  let response = await request.post(`${apiUrl}/v1/sessions/join`, { data });
  if (response.status() === 429) {
    // A rejected 429 runs before the join handler, so retry cannot create an extra guest.
    await waitForJoinWindow(response);
    response = await request.post(`${apiUrl}/v1/sessions/join`, { data });
  }
  return response;
}

export async function joinBetaRound(page: Page) {
  const join = async () => {
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/v1/sessions/join",
    );
    await page.getByRole("button", { name: "Join Round", exact: true }).click();
    return response;
  };
  let response = await join();
  if (response.status() === 429) {
    await waitForJoinWindow(response);
    response = await join();
  }
  expect(response.status()).toBe(201);
  return response;
}

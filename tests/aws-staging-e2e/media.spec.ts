import { expect, test } from "@playwright/test";
import { signInCreator } from "../support/creator-auth";
import { readMailpitCredential } from "../support/mailpit-auth";

test("SMTP sign-in, persistent authoring, browser presigned upload, scanning and private delivery", async ({
  page,
  context,
  request,
}) => {
  const email = `aws-staging-${Date.now()}@example.com`;
  const mailpit = "http://localhost:19182";
  await signInCreator(page, email, {
    verificationUrl: () => readMailpitCredential(mailpit, email, "verification"),
    signInPin: () => readMailpitCredential(mailpit, email, "pin"),
  });
  await expect(page).toHaveURL(/\/home\?welcome=1$/);
  const origin = "http://localhost:19180";
  const presentation = await context.request.post(`${origin}/v1/presentations`, {
    headers: { origin },
    data: { title: "AWS staging rehearsal", initialSlide: "native" },
  });
  expect(presentation.status()).toBe(201);
  const { presentation: created } = await presentation.json();
  expect(created.id).toBeTruthy();
  await page.reload();
  const stored = await context.request.get(`${origin}/v1/presentations/${created.id}`);
  expect(stored.ok()).toBe(true);
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const pending = await context.request.post(`${origin}/v1/media`, {
    headers: { origin },
    data: {
      fileName: "staging-probe.png",
      mimeType: "image/png",
      sizeBytes: image.length,
      altText: "Synthetic staging image",
    },
  });
  expect(pending.status()).toBe(201);
  const { mediaId, uploadUrl } = await pending.json();
  expect(new URL(uploadUrl).origin).toBe("http://localhost:19181");
  // page.evaluate exercises actual browser preflight/CORS, unlike request.put.
  const status = await page.evaluate(
    async ({ url, bytes }) => {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(bytes),
      });
      const text = await response.text();
      return {
        status: response.status,
        code: text.match(/<Code>([^<]+)<\/Code>/)?.[1],
      };
    },
    { url: uploadUrl, bytes: [...image] },
  );
  expect(status).toEqual({ status: 200, code: undefined });
  const deniedOrigin = await request.fetch(uploadUrl, {
    method: "OPTIONS",
    headers: { origin: "https://untrusted.invalid", "access-control-request-method": "PUT" },
  });
  expect(deniedOrigin.headers()["access-control-allow-origin"]).toBeUndefined();
  const completed = await context.request.post(`${origin}/v1/media/${mediaId}/complete`, {
    headers: { origin },
  });
  expect(completed.ok()).toBe(true);
  const result = await completed.json();
  expect(result.media.scanStatus).toBe("clean");
  const imageLoaded = await page.evaluate(async (url) => {
    const element = new Image();
    element.crossOrigin = "anonymous";
    element.src = url;
    await element.decode();
    return element.naturalWidth;
  }, result.downloadUrl);
  expect(imageLoaded).toBe(1);
  expect((await request.get(`${origin}/v1/media/${mediaId}`)).status()).toBe(401);
  const deleted = await context.request.delete(`${origin}/v1/media/${mediaId}`, {
    headers: { origin },
  });
  expect(deleted.ok()).toBe(true);
  expect((await request.get(result.downloadUrl)).status()).toBe(404);
});

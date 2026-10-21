import { expect, test } from "@playwright/test";
import { signInCreator } from "../support/creator-auth";
import { readMailpitCredential } from "../support/mailpit-auth";

const mailpitUrl = (process.env.SMOKE_MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");

test("creator uploads scanned media and a guest receives it privately", async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const creatorContext = await browser.newContext();
  const creator = await creatorContext.newPage();
  const email = `compose-media-${Date.now()}@example.com`;
  await signInCreator(creator, email, {
    segment: "education",
    verificationUrl: () => readMailpitCredential(mailpitUrl, email, "verification"),
    signInPin: () => readMailpitCredential(mailpitUrl, email, "pin"),
  });
  const creatorOrigin = new URL(creator.url()).origin;

  await creator.getByRole("link", { name: "Account", exact: true }).click();
  await expect(creator).toHaveURL(/\/account/);
  await creator.getByLabel("Organization name").fill("Compose Learning");
  await creator.getByRole("button", { name: "Save theme" }).click();
  await expect(creator.getByRole("status")).toContainText("brand theme was saved");
  await creator.getByRole("link", { name: "Dashboard" }).click();

  await creator.getByLabel("Checkpoint set title").fill("Scanned image round");
  await creator.getByRole("button", { name: "Create checkpoint set" }).click();
  await creator.getByRole("button", { name: "True or false" }).click();
  await creator
    .getByRole("textbox", { name: "Checkpoint prompt", exact: true })
    .fill("Can this guest retrieve the scanned image?");
  const altText = "A one-pixel image used to verify private media delivery";
  await creator.getByRole("textbox", { name: "Media", exact: true }).fill(altText);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await creator.getByLabel("Choose instructional image").setInputFiles({
    name: "browser-upload.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(creator.getByAltText(altText)).toBeVisible({ timeout: 30_000 });
  await expect(creator.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await creator.getByRole("button", { name: "Publish" }).click();
  await expect(creator.getByText("published", { exact: true })).toBeVisible();
  await creator.getByRole("link", { name: "Dashboard" }).click();
  await creator.getByRole("button", { name: "Host" }).click();
  await creator.getByRole("button", { name: "Create live session" }).click();
  await expect(creator.getByRole("link", { name: "Compose Learning" })).toBeVisible();
  const code = (await creator.locator(".session-code").textContent())!.trim();
  const expectedJoinUrl = `${new URL(creator.url()).origin}/join?code=${code}`;
  await expect(creator.getByTestId("join-url")).toHaveAttribute("href", expectedJoinUrl);
  await expect(
    creator.getByLabel(new RegExp(`QR code for round ${code.split("").join(" ")}`)),
  ).toBeVisible();

  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`/join?code=${code}`);
  await participant.getByRole("button", { name: "Join round" }).click();
  await expect(participant.getByRole("link", { name: "Compose Learning" })).toBeVisible();
  await creator.getByRole("button", { name: "Start round" }).click();
  const participantImage = participant.getByAltText(altText);
  await expect(participantImage).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => participantImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const signedImageUrl = await participantImage.getAttribute("src");
  expect(signedImageUrl).toBeTruthy();
  await participant.getByRole("button", { name: "True", exact: true }).click();
  await expect(participant.getByText("Answer received and saved.")).toBeVisible();
  await creator.getByRole("button", { name: "Lock answers" }).click();
  await creator.getByRole("button", { name: "Reveal answer" }).click();
  await expect(participant.getByText("Correct", { exact: true })).toBeVisible();

  await creator.goto(`${creatorOrigin}/account`);
  await creator.getByLabel(/Type DELETE/).fill("DELETE");
  await creator.getByRole("button", { name: "Delete account" }).click();
  await expect(creator).toHaveURL(/\/$/);
  expect((await request.get(signedImageUrl!)).status()).toBe(404);

  await participantContext.close();
  await creatorContext.close();
});

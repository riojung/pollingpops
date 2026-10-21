import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api";
import { boardId } from "../../test-utils/idea-board";
import { readBoardIdeaImage } from "./idea-image-resource";

const fixtures = vi.hoisted(() => ({ fetchImage: vi.fn() }));
vi.mock("../../lib/idea-board-client", () => ({ fetchIdeaBoardImage: fixtures.fetchImage }));
const subscriptions: Array<ReturnType<typeof readBoardIdeaImage>> = [];
function read(media = "image", token = "guest") {
  const subscription = readBoardIdeaImage(boardId, media, token);
  subscriptions.push(subscription);
  void subscription.promise.catch(() => {});
  return subscription;
}
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
afterEach(async () => {
  subscriptions.splice(0).forEach((subscription) => subscription.release());
  await settle();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("board image read queue", () => {
  it("coalesces duplicate cards, caps concurrent reads, and isolates credentials", async () => {
    const pending: Array<(blob: Blob) => void> = [];
    fixtures.fetchImage.mockImplementation(
      (_board: string, _media: string, _token: string, signal: AbortSignal) =>
        new Promise<Blob>((resolve, reject) => {
          pending.push(resolve);
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const first = read();
    const duplicate = read();
    read("second");
    read("third");
    read("fourth");
    expect(first.promise).toBe(duplicate.promise);
    expect(fixtures.fetchImage).toHaveBeenCalledTimes(3);
    pending[0]!(new Blob(["first"]));
    await settle();
    expect(fixtures.fetchImage).toHaveBeenCalledTimes(4);
    read("image", "other-guest");
    expect(fixtures.fetchImage).toHaveBeenCalledTimes(4);
    pending[1]!(new Blob(["second"]));
    await settle();
    expect(fixtures.fetchImage).toHaveBeenCalledTimes(5);
    expect(fixtures.fetchImage.mock.calls[4]![2]).toBe("other-guest");
  });

  it("honors Retry-After on a transient rate limit before retrying", async () => {
    vi.useFakeTimers();
    const blob = new Blob(["retried"]);
    fixtures.fetchImage
      .mockRejectedValueOnce(new ApiClientError("Limited", "RATE_LIMITED", 429, 3))
      .mockResolvedValue(blob);
    const image = read();
    await settle();
    await vi.advanceTimersByTimeAsync(2999);
    expect(fixtures.fetchImage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(image.promise).resolves.toBe(blob);
    expect(fixtures.fetchImage).toHaveBeenCalledTimes(2);
  });

  it("cancels pending retry timers when their final projected card disappears", async () => {
    vi.useFakeTimers();
    fixtures.fetchImage.mockRejectedValue(new ApiClientError("Limited", "RATE_LIMITED", 429, 3));
    const first = read();
    const second = read();
    await settle();
    const signal = fixtures.fetchImage.mock.calls[0]![3] as AbortSignal;
    first.release();
    expect(signal.aborted).toBe(false);
    second.release();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixtures.fetchImage).toHaveBeenCalledOnce();
  });

  it("bounds automatic retries and never retries earlier than a long server deadline", async () => {
    vi.useFakeTimers();
    fixtures.fetchImage.mockRejectedValue(new ApiClientError("Limited", "RATE_LIMITED", 429, 1));
    const image = read();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(image.promise).rejects.toMatchObject({ status: 429 });
    expect(fixtures.fetchImage).toHaveBeenCalledTimes(4);
    image.release();
    fixtures.fetchImage.mockRejectedValue(new ApiClientError("Limited", "RATE_LIMITED", 429, 120));
    const later = read("later");
    await expect(later.promise).rejects.toMatchObject({ retryAfterSeconds: 120 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixtures.fetchImage).toHaveBeenCalledTimes(5);
  });
});

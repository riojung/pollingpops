import { describe, expect, it, vi } from "vitest";
import {
  beginJoinPreflight,
  completeJoinPreflight,
  failJoinPreflight,
  idleJoinPreflightState,
  joinArtifactFor,
  nicknameForJoin,
  resolveJoinPreflightForSubmission,
  shouldCollectJoinNickname,
  shouldCollectJoinPassword,
} from "./join-preflight";

describe("join preflight state", () => {
  it("requests passwords only for the current protected room and clears stale results", () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 1), 1, {
      nicknamePolicy: "custom",
      passwordRequired: true,
    });
    expect(shouldCollectJoinPassword(ready, "1234567")).toBe(true);
    expect(shouldCollectJoinPassword(ready, "7654321")).toBe(false);
    expect(shouldCollectJoinPassword(beginJoinPreflight("7654321", 2), "7654321")).toBe(false);
    expect(
      shouldCollectJoinPassword(
        failJoinPreflight(beginJoinPreflight("1234567", 2), 2, "failed"),
        "1234567",
      ),
    ).toBe(false);
  });

  it("defaults older preflight responses to open rooms", () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 1), 1, {
      nicknamePolicy: "custom",
    });
    expect(shouldCollectJoinPassword(ready, "1234567")).toBe(false);
  });
  it("uses only the latest request result", () => {
    const first = beginJoinPreflight("1234567", 1);
    const latest = beginJoinPreflight("7654321", 2);

    expect(
      completeJoinPreflight(latest, first.requestId, { nicknamePolicy: "friendly_only" }),
    ).toBe(latest);
    expect(
      completeJoinPreflight(latest, latest.requestId, {
        nicknamePolicy: "custom",
        artifactType: "presentation",
        destination: "/join",
      }),
    ).toMatchObject({
      code: "7654321",
      status: "ready",
      nicknamePolicy: "custom",
      artifactType: "presentation",
      destination: "/join",
    });
  });

  it("omits a nickname for a confirmed friendly-alias room", () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 1), 1, {
      nicknamePolicy: "friendly_only",
    });

    expect(shouldCollectJoinNickname(ready, "1234567")).toBe(false);
    expect(nicknameForJoin(ready, "1234567", "Must not be sent")).toBeUndefined();
    expect(shouldCollectJoinNickname(ready, "7654321")).toBe(true);
  });

  it("submits a chosen nickname or requests a generated fallback for a custom-name room", () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 1), 1, {
      nicknamePolicy: "custom",
    });

    expect(shouldCollectJoinNickname(ready, "1234567")).toBe(true);
    expect(nicknameForJoin(ready, "1234567", "  My chosen name  ")).toBe("My chosen name");
    expect(nicknameForJoin(ready, "1234567", "   ")).toBeUndefined();
  });

  it("keeps nickname submission available when preflight fails", () => {
    const failed = failJoinPreflight(
      beginJoinPreflight("1234567", 3),
      3,
      "Could not check this code",
    );

    expect(failed).toMatchObject({ status: "failed", nicknamePolicy: null });
    expect(shouldCollectJoinNickname(failed, "1234567")).toBe(true);
    expect(nicknameForJoin(failed, "1234567", "  Learner  ")).toBe("Learner");
    expect(nicknameForJoin(idleJoinPreflightState, "1234567", "   ")).toBeUndefined();
  });

  it("selects the Presentation flow only for the matching resolved code", () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 4), 4, {
      nicknamePolicy: "custom",
      artifactType: "presentation",
      destination: "/join",
    });

    expect(joinArtifactFor(ready, "1234567")).toBe("presentation");
    expect(joinArtifactFor(ready, "7654321")).toBeNull();
    expect(shouldCollectJoinNickname(ready, "1234567")).toBe(true);
  });

  it("rechecks failed preflight before selecting a join endpoint", async () => {
    const failed = failJoinPreflight(
      beginJoinPreflight("1234567", 5),
      5,
      "Could not check this code",
    );
    const check = vi.fn().mockResolvedValue({
      nicknamePolicy: "custom",
      artifactType: "presentation",
      destination: "/join",
    });

    expect(joinArtifactFor(failed, "1234567")).toBeNull();

    const resolved = await resolveJoinPreflightForSubmission(failed, "1234567", 6, check);

    expect(check).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledWith("1234567");
    expect(resolved).toMatchObject({
      requestId: 6,
      code: "1234567",
      status: "ready",
      artifactType: "presentation",
    });
    expect(joinArtifactFor(resolved, "1234567")).toBe("presentation");
  });

  it("reuses a matching resolved preflight on submit", async () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 7), 7, {
      nicknamePolicy: "friendly_only",
    });
    const check = vi.fn();

    await expect(resolveJoinPreflightForSubmission(ready, "1234567", 8, check)).resolves.toBe(
      ready,
    );
    expect(check).not.toHaveBeenCalled();
  });
});

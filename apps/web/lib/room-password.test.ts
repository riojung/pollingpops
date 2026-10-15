import { describe, expect, it } from "vitest";
import { ApiClientError } from "./api";
import {
  canProtectRoom,
  roomPasswordErrorKey,
  roomPasswordFields,
  validRoomPassword,
} from "./room-password";

describe("room passwords", () => {
  it("requires paid effective launch entitlements", () => {
    expect(canProtectRoom(null)).toBe(false);
    expect(canProtectRoom({ plan: "free" })).toBe(false);
    expect(canProtectRoom({ plan: "pro" })).toBe(true);
    expect(canProtectRoom({ plan: "team" })).toBe(true);
  });

  it("leaves every run open by default and preserves exact selected protection", () => {
    expect(roomPasswordFields(true, false, "password")).toEqual({});
    expect(roomPasswordFields(true, true, "  exact password  ")).toEqual({
      joinPassword: "  exact password  ",
    });
  });

  it("refuses to downgrade selected protection after paid funding is removed until explicitly unchecked", () => {
    expect(roomPasswordFields(true, true, "password")).toEqual({ joinPassword: "password" });
    expect(() => roomPasswordFields(false, true, "password")).toThrow(
      "Password protection requires paid room entitlements",
    );
    expect(roomPasswordFields(false, false, "")).toEqual({});
  });

  it("validates the exact password without trimming", () => {
    expect(validRoomPassword("  pass  ")).toBe(true);
    expect(validRoomPassword("1234567")).toBe(false);
    expect(validRoomPassword(" ".repeat(8))).toBe(false);
    expect(validRoomPassword("\t\n".repeat(8))).toBe(false);
    expect(validRoomPassword("x".repeat(128))).toBe(true);
    expect(validRoomPassword("x".repeat(129))).toBe(false);
  });

  it("maps admission failures to localized actionable copy", () => {
    expect(
      roomPasswordErrorKey(new ApiClientError("server message", "PASSWORD_REQUIRED", 403)),
    ).toBe("live.protection.required");
    expect(
      roomPasswordErrorKey(new ApiClientError("server message", "INVALID_PASSWORD", 403)),
    ).toBe("live.protection.invalid");
    expect(roomPasswordErrorKey(new Error("other"))).toBeNull();
  });
});

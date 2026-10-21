import { describe, expect, it } from "vitest";
import { credentialFromMail } from "./mailpit-auth";

describe("captured creator auth email parsing", () => {
  const verification =
    "Verify your email: http://localhost:4000/v1/auth/verify?token=opaque-token-123456789";
  const pin = "Your Polling Pops sign-in PIN is 024680. It expires in 10 minutes.";

  it("keeps verification and PIN messages separate", () => {
    expect(credentialFromMail(verification, "verification")).toBe(
      "http://localhost:4000/v1/auth/verify?token=opaque-token-123456789",
    );
    expect(credentialFromMail(verification, "pin")).toBeUndefined();
    expect(credentialFromMail(pin, "verification")).toBeUndefined();
    expect(credentialFromMail(pin, "pin")).toBe("024680");
  });

  it("rejects unrelated numeric mail and PINs of the wrong length", () => {
    expect(credentialFromMail("Your order reference is 123456", "pin")).toBeUndefined();
    expect(credentialFromMail("Your sign-in PIN is 12345", "pin")).toBeUndefined();
    expect(credentialFromMail("Your sign-in PIN is 1234567", "pin")).toBeUndefined();
  });
});

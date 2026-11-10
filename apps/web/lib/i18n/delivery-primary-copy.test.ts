import { supportedLocales } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  deliveryPrimaryCopy,
  deliveryPrimaryKeys,
  localizeDeliveryMessage,
} from "./delivery-primary-copy";
import {
  HOST_ACK_TIMEOUT_MESSAGE,
  PARTICIPANT_ACK_CHECKING_MESSAGE,
} from "../realtime-mutation-recovery";

describe("primary delivery localization", () => {
  it.each(supportedLocales)(
    "provides complete labels and retains interpolation tokens in %s",
    (locale) => {
      const copy = deliveryPrimaryCopy(locale);
      for (const key of deliveryPrimaryKeys) {
        expect(copy(key).trim(), `${locale}: ${key}`).not.toBe("");
        expect(copy(key).match(/\{\w+\}/g) ?? []).toEqual(key.match(/\{\w+\}/g) ?? []);
      }
      expect(copy("Question {current} of {total}", { current: 2, total: 8 })).not.toMatch(
        /\{\w+\}/,
      );
    },
  );

  it("keeps retry semantics localized without changing controller message identities", () => {
    expect(localizeDeliveryMessage("fr-FR", HOST_ACK_TIMEOUT_MESSAGE)).toMatchObject({
      known: true,
      language: "fr-FR",
      text: "Le serveur n’a pas confirmé cette action. Vérifiez l’état de la salle et réessayez.",
    });
    expect(localizeDeliveryMessage("ko-KR", PARTICIPANT_ACK_CHECKING_MESSAGE).text).toContain(
      "저장 여부 확인 중",
    );
    expect(PARTICIPANT_ACK_CHECKING_MESSAGE).toBe(
      "The response acknowledgement was delayed. Checking whether it was saved…",
    );
  });

  it("preserves unknown service text and identifiers instead of inventing translations", () => {
    const message = "Synthetic service detail: room-123";
    expect(localizeDeliveryMessage("fr-FR", message)).toEqual({
      known: false,
      language: "en-CA",
      text: message,
    });
    expect(
      deliveryPrimaryCopy("ja-JP")(
        "Report generation failed. Contact support with report ID {id} to request a safe retry.",
        { id: "room-123" },
      ),
    ).toContain("room-123");
  });
});

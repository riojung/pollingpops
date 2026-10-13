import { describe, expect, it } from "vitest";
import { parseCatalog, publicCatalog, requirePublishedOffer } from "../src/catalog.js";

describe("configured business catalog", () => {
  it("defaults to no purchasable offers and hides provider price identifiers", () => {
    expect(publicCatalog(parseCatalog())).toEqual([]);
    const offers = parseCatalog(
      JSON.stringify([
        {
          id: "pass-five",
          version: 2,
          title: "Five event credits",
          kind: "event_credit_pack",
          published: true,
          stripePriceId: "price_abc",
          currency: "cad",
          unitAmount: 1000,
          creditsPerUnit: 5,
        },
        {
          id: "pro",
          version: 1,
          title: "Pro workspace",
          kind: "workspace_subscription",
          interval: "month",
        },
      ]),
    );
    expect(publicCatalog(offers)).toEqual([
      {
        id: "pass-five",
        version: 2,
        title: "Five event credits",
        kind: "event_credit_pack",
        published: true,
        currency: "cad",
        unitAmount: 1000,
        creditsPerUnit: 5,
      },
    ]);
    expect(() => requirePublishedOffer(offers, "pass-five", 1)).toThrow("no longer available");
    expect(() => requirePublishedOffer(offers, "pro", 1)).toThrow("no longer available");
  });

  it("rejects ambiguous prices, incorrect offer types, and incomplete published offers", () => {
    expect(() => parseCatalog("not-json")).toThrow("valid JSON");
    expect(() =>
      parseCatalog(
        JSON.stringify([
          { id: "bad", version: 1, title: "Bad", kind: "event_credit_pack", published: true },
        ]),
      ),
    ).toThrow();
    expect(() =>
      parseCatalog(
        JSON.stringify([
          {
            id: "bad",
            version: 1,
            title: "Bad",
            kind: "workspace_subscription",
            interval: "month",
            creditsPerUnit: 5,
          },
        ]),
      ),
    ).toThrow();
    const pack = {
      version: 1,
      title: "Credits",
      kind: "event_credit_pack",
      creditsPerUnit: 5,
      stripePriceId: "price_same",
    };
    expect(() =>
      parseCatalog(
        JSON.stringify([
          { ...pack, id: "one" },
          { ...pack, id: "two" },
        ]),
      ),
    ).toThrow();
  });
});

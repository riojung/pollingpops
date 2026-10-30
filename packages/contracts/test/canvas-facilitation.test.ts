import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanvasBoardMutationV1Schema,
  CanvasBoardMutationSchema,
  CanvasFacilitationMutationSchema,
  CanvasGuestFacilitationViewSchema,
  CanvasExportRequestSchema,
  CanvasPresenterMutationSchema,
  CanvasGuestPresenterViewSchema,
} from "../src/index.js";

describe("independent canvas facilitation protocol", () => {
  it("keeps comments out of the accepted V1/V2 canvas protocol", () => {
    const mutation = {
      schemaVersion: 1,
      operationId: randomUUID(),
      command: {
        type: "comment_thread_create",
        threadId: randomUUID(),
        messageId: randomUUID(),
        objectId: randomUUID(),
        text: "  Cafe\u0301 discussion  ",
      },
    };
    expect(CanvasFacilitationMutationSchema.parse(mutation).command).toMatchObject({
      text: "Café discussion",
    });
    expect(CanvasBoardMutationV1Schema.safeParse(mutation).success).toBe(false);
    expect(CanvasBoardMutationSchema.safeParse({ ...mutation, schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(CanvasFacilitationMutationSchema.safeParse({ ...mutation, extra: true }).success).toBe(
      false,
    );
    expect(
      CanvasFacilitationMutationSchema.safeParse({
        ...mutation,
        command: { ...mutation.command, text: "bad\u0000text" },
      }).success,
    ).toBe(false);
    expect(
      CanvasFacilitationMutationSchema.safeParse({
        ...mutation,
        command: { ...mutation.command, text: "x".repeat(2001) },
      }).success,
    ).toBe(false);
  });
  it("requires explicit timer fences and bounded durations", () => {
    const mutation = {
      schemaVersion: 1,
      operationId: randomUUID(),
      command: { type: "timer_start", expectedRevision: 0, durationSeconds: 5 },
    };
    expect(CanvasFacilitationMutationSchema.safeParse(mutation).success).toBe(true);
    for (const durationSeconds of [4, 7201, Infinity, NaN, 5.5])
      expect(
        CanvasFacilitationMutationSchema.safeParse({
          ...mutation,
          command: { ...mutation.command, durationSeconds },
        }).success,
      ).toBe(false);
    expect(
      CanvasFacilitationMutationSchema.safeParse({ ...mutation, command: { type: "timer_pause" } })
        .success,
    ).toBe(false);
  });
  it("admits only timer metadata to the guest facilitation view", () => {
    const guest = {
      schemaVersion: 1,
      boardId: randomUUID(),
      canvasSeq: 1,
      serverNow: "2026-10-30T00:00:00.000Z",
      timer: {
        revision: 0,
        status: "idle",
        durationSeconds: null,
        remainingMs: 0,
        deadlineAt: null,
      },
    };
    expect(CanvasGuestFacilitationViewSchema.parse(guest)).toEqual(guest);
    for (const extra of [{ threads: [] }, { versions: [] }, { actorId: randomUUID() }])
      expect(CanvasGuestFacilitationViewSchema.safeParse({ ...guest, ...extra }).success).toBe(
        false,
      );
  });
  it("bounds explicit SVG regions and rejects other export formats", () => {
    const request = {
      schemaVersion: 1,
      format: "svg",
      region: { x: -100, y: 50, width: 500, height: 200 },
    };
    expect(CanvasExportRequestSchema.parse(request)).toMatchObject({ background: "white" });
    for (const region of [
      { ...request.region, width: 0 },
      { ...request.region, x: Infinity },
      { ...request.region, height: 100001 },
    ])
      expect(CanvasExportRequestSchema.safeParse({ ...request, region }).success).toBe(false);
    expect(CanvasExportRequestSchema.safeParse({ ...request, format: "png" }).success).toBe(false);
  });
  it("fences presenter sessions separately and omits principal/private viewport from guests", () => {
    expect(
      CanvasPresenterMutationSchema.safeParse({
        schemaVersion: 1,
        operationId: randomUUID(),
        sessionId: randomUUID(),
        expectedRevision: 0,
        command: { type: "start", audience: "published", frameId: randomUUID(), viewport: null },
      }).success,
    ).toBe(true);
    const guest = {
      schemaVersion: 1,
      boardId: randomUUID(),
      serverNow: "2026-10-30T00:00:00.000Z",
      revision: 1,
      active: true,
      sessionId: randomUUID(),
      audience: "published",
      frameId: randomUUID(),
      viewport: null,
      expiresAt: "2026-10-30T00:00:15.000Z",
    };
    expect(CanvasGuestPresenterViewSchema.safeParse(guest).success).toBe(true);
    expect(
      CanvasGuestPresenterViewSchema.safeParse({ ...guest, presenterId: randomUUID() }).success,
    ).toBe(false);
    expect(
      CanvasGuestPresenterViewSchema.safeParse({
        ...guest,
        viewport: { x: 0, y: 0, width: 100, height: 100 },
      }).success,
    ).toBe(false);
  });
});

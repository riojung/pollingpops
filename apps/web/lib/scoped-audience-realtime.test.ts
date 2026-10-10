import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Socket } from "socket.io-client";
import { createScopedAudienceSubscription } from "./scoped-audience-realtime";

class FakeSocket {
  handlers = new Map<string, Set<(value?: unknown) => void>>();
  emissions: Array<{
    event: string;
    payload: unknown;
    ack: (error: Error | null, value?: unknown) => void;
  }> = [];
  on(event: string, handler: (value?: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: (value?: unknown) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  timeout() {
    return this;
  }
  emit(event: string, payload: unknown, ack: (error: Error | null, value?: unknown) => void) {
    this.emissions.push({ event, payload, ack });
  }
  fire(event: string, value?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(value);
  }
  connect() {
    this.fire("connect");
  }
  disconnect = vi.fn(() => this.fire("disconnect"));
}
function setup() {
  const socket = new FakeSocket();
  const onRefresh = vi.fn();
  const onAccessDenied = vi.fn();
  const scopeId = randomUUID();
  const scope = {
    schemaVersion: 1,
    scopeId,
    kind: "presentation",
    lifecycle: "open",
    identityPolicy: "facilitator_visible_alias",
    identityDisclosure: "Facilitators see aliases",
    audienceSeq: 1,
    permissions: { read: true, submit: false, moderate: false, manageSettings: false },
    features: { qna: true, chat: false, pulse: false },
  };
  const subscription = createScopedAudienceSubscription({
    scopeId,
    token: "native-pass",
    onRefresh,
    onAccessDenied,
    socketFactory: () => socket as unknown as Socket,
  });
  const notice = (seq: number) => ({
    schemaVersion: 1,
    eventId: randomUUID(),
    scopeId,
    audienceSeq: seq,
    serverTime: new Date().toISOString(),
    type: "audience.qna.updated",
    payload: { kind: "presentation" },
  });
  return { socket, onRefresh, onAccessDenied, scope, subscription, notice };
}
describe("separate scoped audience cursor", () => {
  it("does not let an old connection acknowledgement disable fallback polling", () => {
    const { socket, scope, subscription, onRefresh } = setup();
    socket.fire("disconnect");
    socket.emissions[0]!.ack(null, { data: { scope } });
    expect(subscription.needsPolling()).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
    socket.fire("connect");
    socket.emissions[1]!.ack(null, { data: { scope } });
    expect(subscription.needsPolling()).toBe(false);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    subscription.stop();
  });
  it("deduplicates notices and synchronizes current state after a gap or reconnect", () => {
    const { socket, scope, subscription, onRefresh, notice } = setup();
    expect(subscription.needsPolling()).toBe(true);
    expect(socket.emissions[0]!.event).toBe("audience.scope.subscribe");
    socket.emissions[0]!.ack(null, { data: { scope } });
    expect(subscription.needsPolling()).toBe(false);
    socket.fire("audience.qna.updated", notice(2));
    socket.fire("audience.qna.updated", notice(2));
    socket.fire("audience.qna.updated", notice(1));
    expect(onRefresh).toHaveBeenCalledTimes(2);
    socket.fire("audience.qna.updated", notice(8));
    expect(onRefresh).toHaveBeenCalledTimes(3);
    socket.fire("disconnect");
    expect(subscription.needsPolling()).toBe(true);
    socket.fire("connect");
    socket.emissions[1]!.ack(null, { data: { scope: { ...scope, audienceSeq: 8 } } });
    expect(onRefresh).toHaveBeenCalledTimes(4);
    subscription.stop();
  });
  it("ignores foreign, future and text-bearing events and cleans up late callbacks", () => {
    const { socket, scope, subscription, onRefresh, notice } = setup();
    socket.emissions[0]!.ack(null, { data: { scope } });
    socket.fire("audience.qna.updated", { ...notice(2), scopeId: randomUUID() });
    socket.fire("audience.qna.updated", { ...notice(2), schemaVersion: 2 });
    socket.fire("audience.qna.updated", {
      ...notice(2),
      payload: { kind: "presentation", body: "Hidden" },
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    subscription.stop();
    socket.fire("audience.qna.updated", notice(3));
    socket.emissions[0]!.ack(null, { data: { scope } });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect([...socket.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
  });
  it("keeps a polling fallback on timeout and signals revoked access", () => {
    const { socket, subscription, onAccessDenied } = setup();
    socket.emissions[0]!.ack(new Error("Timeout"));
    expect(subscription.needsPolling()).toBe(true);
    socket.fire("connect");
    socket.emissions[1]!.ack(null, { error: { code: "UNAUTHORIZED" } });
    expect(onAccessDenied).toHaveBeenCalledTimes(1);
    expect(subscription.needsPolling()).toBe(true);
    subscription.stop();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { RevisionHub } from "./hub";

afterEach(() => {
  vi.useRealTimers();
});

describe("RevisionHub", () => {
  it("100ms 窗口内合并连发，只送最新 revision", async () => {
    vi.useFakeTimers();
    const hub = new RevisionHub();
    const received: number[] = [];
    hub.subscribe("e1", { send: (text) => received.push(JSON.parse(text.slice(6)).revision) });
    hub.publish("e1", 10);
    hub.publish("e1", 11);
    hub.publish("e1", 12);
    expect(received).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(received).toEqual([12]);
    hub.dispose();
  });

  it("订阅取消后不再收到推送；send 抛错自动退订", async () => {
    vi.useFakeTimers();
    const hub = new RevisionHub();
    const received: number[] = [];
    const client = hub.subscribe("e1", { send: (text) => received.push(JSON.parse(text.slice(6)).revision) });
    const failing = hub.subscribe("e1", {
      send: () => {
        throw new Error("broken pipe");
      },
    });
    hub.publish("e1", 1);
    vi.advanceTimersByTime(150);
    expect(received).toEqual([1]);
    hub.unsubscribe("e1", client.id);
    hub.unsubscribe("e1", failing.id);
    expect(hub.subscriberCount("e1")).toBe(0);
    hub.publish("e1", 2);
    vi.advanceTimersByTime(150);
    expect(received).toEqual([1]);
    hub.dispose();
  });

  it("不同 event 互不串扰", async () => {
    vi.useFakeTimers();
    const hub = new RevisionHub();
    const a: number[] = [];
    const b: number[] = [];
    hub.subscribe("a", { send: (t) => a.push(JSON.parse(t.slice(6)).revision) });
    hub.subscribe("b", { send: (t) => b.push(JSON.parse(t.slice(6)).revision) });
    hub.publish("a", 5);
    vi.advanceTimersByTime(150);
    expect(a).toEqual([5]);
    expect(b).toEqual([]);
    hub.dispose();
  });
});

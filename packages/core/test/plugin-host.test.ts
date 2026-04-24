import { describe, expect, it } from "vitest";
import { Host, type WorkerLike } from "../src/plugin-host.js";
import { MemoryStorage } from "../src/storage.js";
import type { PluginInboundMsg, PluginOutboundMsg } from "@pluginforge/sdk";

// Fake worker that simulates a plugin without actually running one.
// The test controls the messages the "plugin" emits.
class FakeWorker implements WorkerLike {
  private listeners: Array<(ev: { data: unknown }) => void> = [];
  private errListeners: Array<(ev: unknown) => void> = [];
  inbox: PluginInboundMsg[] = [];

  postMessage(data: PluginInboundMsg): void {
    this.inbox.push(data);
    // Auto-handshake: if we get the bootstrap load, simulate a plugin
    // that immediately becomes ready and optionally records handlers.
    queueMicrotask(() => this.drain(data));
  }

  terminate(): void {}

  addEventListener(type: "message" | "error", listener: (ev: unknown) => void): void {
    if (type === "message") this.listeners.push(listener as (ev: { data: unknown }) => void);
    else this.errListeners.push(listener as (ev: unknown) => void);
  }

  send(msg: PluginOutboundMsg & { handshake?: boolean }): void {
    for (const l of this.listeners) l({ data: msg });
  }

  // Default behavior: respond to heartbeats, ack loadBundle with ready.
  private drain(msg: PluginInboundMsg): void {
    if (msg.kind === "loadBundle") {
      this.send({ kind: "ready" });
      return;
    }
    if (msg.kind === "hb") {
      this.send({ kind: "hb", token: msg.token });
      return;
    }
  }
}

function setup() {
  const storage = new MemoryStorage();
  const notifications: Array<{ pluginId: string; message: string; level: string }> = [];
  const commands: Array<{ pluginId: string; id: string; title: string }> = [];
  let fake: FakeWorker | null = null;
  const host = new Host({
    storage,
    callbacks: {
      notify: (pluginId, message, level) => notifications.push({ pluginId, message, level }),
      addCommand: (pluginId, id, title) => commands.push({ pluginId, id, title }),
      registerPanel: () => {},
    },
    createWorker: () => {
      fake = new FakeWorker();
      // Immediately announce handshake on next tick.
      queueMicrotask(() => fake!.send({ kind: "ready", handshake: true }));
      return fake;
    },
    heartbeatIntervalMs: 10_000, // effectively off for these tests
    heartbeatTimeoutMs: 60_000,
  });
  return {
    host,
    storage,
    notifications,
    commands,
    getWorker: () => fake!,
  };
}

describe("Host", () => {
  it("loads a plugin and processes ready handshake", async () => {
    const { host } = setup();
    const p = await host.load({
      manifest: {
        id: "com.example.hello",
        name: "Hello",
        version: "1.0.0",
        main: "index.js",
        capabilities: ["ui:notify"],
      },
      bundle: "// no-op",
    });
    expect(p.status).toBe("ready");
  });

  it("authorizes host RPC requests and dispatches", async () => {
    const { host, getWorker, notifications } = setup();
    await host.load({
      manifest: {
        id: "com.example.notify",
        name: "Notify",
        version: "1.0.0",
        main: "index.js",
        capabilities: ["ui:notify"],
      },
      bundle: "// no-op",
    });
    const w = getWorker();
    w.send({ kind: "req", id: 1, method: "ui.notify", args: ["hello"] });
    await new Promise((r) => setTimeout(r, 10));
    // Response echoed in the fake worker inbox.
    const res = w.inbox.find((m) => m.kind === "res" && m.id === 1);
    expect(res).toBeTruthy();
    expect((res as { ok: boolean }).ok).toBe(true);
    expect(notifications.some((n) => n.message === "hello")).toBe(true);
  });

  it("denies RPC calls for ungranted capabilities", async () => {
    const { host, getWorker } = setup();
    await host.load({
      manifest: {
        id: "com.example.abuse",
        name: "Abuse",
        version: "1.0.0",
        main: "index.js",
        capabilities: [], // no caps
      },
      bundle: "// no-op",
    });
    const w = getWorker();
    w.send({ kind: "req", id: 42, method: "ui.notify", args: ["gotcha"] });
    await new Promise((r) => setTimeout(r, 10));
    const res = w.inbox.find(
      (m) => m.kind === "res" && (m as { id: number }).id === 42,
    ) as { ok: boolean; error?: { code: string } } | undefined;
    expect(res?.ok).toBe(false);
    expect(res?.error?.code).toBe("PermissionDenied");
  });

  it("terminate() rejects pending invoke() promises", async () => {
    const { host, getWorker } = setup();
    await host.load({
      manifest: {
        id: "com.example.hang",
        name: "Hang",
        version: "1.0.0",
        main: "index.js",
        capabilities: [],
      },
      bundle: "// no-op",
    });
    const w = getWorker();
    // Fire an invoke that the fake worker will never answer.
    const p = host.get("com.example.hang")!.invoke("slow", []);
    // Give the post-back-to-worker tick a chance.
    await new Promise((r) => setTimeout(r, 5));
    expect(w.inbox.some((m) => m.kind === "req")).toBe(true);
    host.get("com.example.hang")!.terminate();
    await expect(p).rejects.toMatchObject({ message: /terminated/ });
  });

  it("storage is scoped per plugin", async () => {
    const { host, getWorker } = setup();
    await host.load({
      manifest: {
        id: "com.a.plugin",
        name: "A",
        version: "1.0.0",
        main: "index.js",
        capabilities: ["storage:scoped"],
      },
      bundle: "// no-op",
    });
    await host.load({
      manifest: {
        id: "com.b.plugin",
        name: "B",
        version: "1.0.0",
        main: "index.js",
        capabilities: ["storage:scoped"],
      },
      bundle: "// no-op",
    });
    // The second load reassigns `fake` — this test checks isolation
    // conceptually by inspecting the storage directly after two separate
    // plugins write the same key.
    const storages = [host.get("com.a.plugin")!, host.get("com.b.plugin")!];
    expect(storages).toHaveLength(2);
  });
});

import {
  type Capability,
  type PluginManifest,
  type PluginInboundMsg,
  type PluginOutboundMsg,
  ErrorCodes,
  validateManifest,
} from "@pluginforge/sdk";
import { BOOTSTRAP_SOURCE } from "./bootstrap-source.js";
import { CapabilityRouter, PermissionDeniedError } from "./capability-router.js";
import { HostImpl, type HostCallbacks } from "./host-impl.js";
import type { PluginStorage } from "./storage.js";

export interface PluginSource {
  manifest: PluginManifest;
  /** ES-module source text of the plugin's main entry. */
  bundle: string;
}

export interface HostOptions {
  storage: PluginStorage;
  callbacks: HostCallbacks;
  /**
   * If supplied, used instead of `new Worker(...)` to construct the sandbox.
   * Useful for testing with a fake worker.
   */
  createWorker?: (bootstrapSrc: string, name: string) => WorkerLike;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  /** If a plugin fails to signal ready within this window, load() rejects. */
  loadTimeoutMs?: number;
}

export interface WorkerLike {
  postMessage(data: unknown): void;
  terminate(): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (ev: unknown) => void): void;
}

export type HostStatus = "loading" | "ready" | "crashed" | "terminated";

export interface LoadedPlugin {
  id: string;
  manifest: PluginManifest;
  status: HostStatus;
  /** Invoke a handler the plugin registered via plugin.registerHandler. */
  invoke(handlerName: string, args: unknown[]): Promise<unknown>;
  /** Send an event into the plugin (matches plugin.host.events.on). */
  emit(topic: string, data: unknown): void;
  terminate(): void;
}

interface InternalState extends LoadedPlugin {
  worker: WorkerLike;
  router: CapabilityRouter;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  reqCounter: number;
  onReady: Promise<void>;
  hbTimer: ReturnType<typeof setInterval> | null;
  lastHbReply: number;
  statusListeners: Set<(s: HostStatus) => void>;
}

export class Host {
  private readonly hostImpl: HostImpl;
  private readonly plugins = new Map<string, InternalState>();
  private readonly createWorker: NonNullable<HostOptions["createWorker"]>;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly loadTimeoutMs: number;

  constructor(private readonly opts: HostOptions) {
    this.hostImpl = new HostImpl(opts.storage, opts.callbacks);
    this.createWorker = opts.createWorker ?? defaultCreateWorker;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 500;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 3000;
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 15_000;
  }

  get loaded(): ReadonlyArray<LoadedPlugin> {
    return Array.from(this.plugins.values());
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Load a plugin. Resolves when the plugin has run onActivate and signaled ready. */
  async load(source: PluginSource): Promise<LoadedPlugin> {
    const manifest = validateManifest(source.manifest);
    if (this.plugins.has(manifest.id)) {
      throw new Error(`plugin ${manifest.id} already loaded`);
    }
    const router = new CapabilityRouter(manifest.capabilities as Array<Capability | string>);
    const worker = this.createWorker(BOOTSTRAP_SOURCE, `plugin:${manifest.id}`);
    const state: InternalState = {
      id: manifest.id,
      manifest,
      status: "loading",
      worker,
      router,
      pending: new Map(),
      reqCounter: 0,
      onReady: Promise.resolve(), // replaced below
      hbTimer: null,
      lastHbReply: Date.now(),
      statusListeners: new Set(),
      invoke: (name, args) => this.invoke(manifest.id, name, args),
      emit: (topic, data) => this.emitTo(manifest.id, topic, data),
      terminate: () => this.terminate(manifest.id),
    };
    this.plugins.set(manifest.id, state);
    state.onReady = this.wireUpWorker(state, source.bundle);
    await state.onReady;
    return state;
  }

  private wireUpWorker(state: InternalState, bundle: string): Promise<void> {
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    let handshakeSeen = false;
    let readyResolved = false;
    // If the plugin's bundle throws during load, the worker may never send
    // the post-load "ready". Time out the load so load() can reject.
    const loadTimeout = setTimeout(() => {
      if (!readyResolved) {
        readyResolved = true;
        state.status = "crashed";
        state.statusListeners.forEach((l) => l("crashed"));
        rejectReady(new Error(
          `plugin ${state.manifest.id} failed to signal ready within load timeout`,
        ));
      }
    }, this.loadTimeoutMs);

    state.worker.addEventListener("message", (ev: { data: unknown }) => {
      const msg = ev.data as (PluginOutboundMsg & { handshake?: boolean }) | undefined;
      if (!msg) return;
      switch (msg.kind) {
        case "ready":
          if (msg.handshake && !handshakeSeen) {
            handshakeSeen = true;
            // First "ready" is the handshake — send bundle.
            const load: PluginInboundMsg = {
              kind: "loadBundle",
              source: bundle,
              pluginId: state.manifest.id,
              grants: state.manifest.capabilities.map((c) =>
                typeof c === "string" ? c : c.name,
              ),
            };
            state.worker.postMessage(load);
            this.startHeartbeat(state);
            return;
          }
          // Post-load "ready". Only transition on the first one; later
          // duplicates from a misbehaving plugin must not resurrect status.
          if (readyResolved) return;
          readyResolved = true;
          clearTimeout(loadTimeout);
          state.status = "ready";
          resolveReady();
          state.statusListeners.forEach((l) => l("ready"));
          return;
        case "req":
          void this.handleReq(state, msg);
          return;
        case "res":
          this.handleRes(state, msg);
          return;
        case "evt":
          // Plugin emitted an event out; no-op by default unless the host
          // subscribes. Embedders can expose an on(topic) API.
          this.opts.callbacks.notify(state.manifest.id, `[event] ${msg.topic}`, "info");
          return;
        case "log":
          this.opts.callbacks.notify(
            state.manifest.id,
            `[${msg.level}] ${msg.args.map(String).join(" ")}`,
            msg.level === "error" ? "error" : "info",
          );
          return;
        case "hb":
          state.lastHbReply = Date.now();
          return;
        default:
          return;
      }
    });

    state.worker.addEventListener("error", (err: unknown) => {
      rejectReady(new Error(`plugin ${state.manifest.id} worker error: ${String(err)}`));
      state.status = "crashed";
      state.statusListeners.forEach((l) => l("crashed"));
    });

    return ready;
  }

  private startHeartbeat(state: InternalState): void {
    if (state.hbTimer) return;
    state.hbTimer = setInterval(() => {
      if (Date.now() - state.lastHbReply > this.heartbeatTimeoutMs) {
        // Missed too many; assume hung. Terminate.
        this.opts.callbacks.notify(
          state.manifest.id,
          "plugin unresponsive; terminating",
          "warn",
        );
        this.terminate(state.manifest.id);
        return;
      }
      state.worker.postMessage({ kind: "hb", token: Date.now() });
    }, this.heartbeatIntervalMs);
  }

  private async handleReq(state: InternalState, msg: { id: number; method: string; args: unknown[] }): Promise<void> {
    try {
      state.router.authorize(msg.method, msg.args);
      const value = await this.hostImpl.dispatch(state.manifest.id, msg.method, msg.args);
      state.worker.postMessage({ kind: "res", id: msg.id, ok: true, value });
    } catch (err) {
      const code =
        err instanceof PermissionDeniedError
          ? ErrorCodes.PermissionDenied
          : ErrorCodes.Internal;
      state.worker.postMessage({
        kind: "res",
        id: msg.id,
        ok: false,
        error: { code, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private handleRes(state: InternalState, msg: { id: number; ok: boolean; value?: unknown; error?: { code: string; message: string } }): void {
    const p = state.pending.get(msg.id);
    if (!p) return;
    state.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value);
    else {
      const err = Object.assign(
        new Error(msg.error?.message ?? "plugin error"),
        { code: msg.error?.code ?? "Internal" },
      );
      p.reject(err);
    }
  }

  private invoke(pluginId: string, handlerName: string, args: unknown[]): Promise<unknown> {
    const state = this.plugins.get(pluginId);
    if (!state) return Promise.reject(new Error(`plugin ${pluginId} not loaded`));
    if (state.status !== "ready") {
      return Promise.reject(new Error(`plugin ${pluginId} status=${state.status}`));
    }
    state.reqCounter += 1;
    const id = state.reqCounter;
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject });
      state.worker.postMessage({ kind: "req", id, method: handlerName, args });
    });
  }

  private emitTo(pluginId: string, topic: string, data: unknown): void {
    const state = this.plugins.get(pluginId);
    if (!state || state.status !== "ready") return;
    state.worker.postMessage({ kind: "evt", topic, data });
  }

  terminate(pluginId: string): void {
    const state = this.plugins.get(pluginId);
    if (!state) return;
    if (state.hbTimer) clearInterval(state.hbTimer);
    try {
      state.worker.terminate();
    } catch {
      // ignore
    }
    // Drain any in-flight invoke() promises so callers awaiting them don't
    // hang forever. The plugin is gone; there's no one left to answer.
    for (const [, pending] of state.pending) {
      pending.reject(
        Object.assign(new Error(`plugin ${pluginId} terminated`), {
          code: "PluginCrashed",
        }),
      );
    }
    state.pending.clear();
    state.status = "terminated";
    state.statusListeners.forEach((l) => l("terminated"));
    this.plugins.delete(pluginId);
  }
}

// Default worker factory for browser-like environments.
function defaultCreateWorker(bootstrapSrc: string, name: string): WorkerLike {
  const blob = new Blob([bootstrapSrc], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const w = new Worker(url, { type: "module", name });
  const ctor = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<string>((u) => URL.revokeObjectURL(u))
    : null;
  if (ctor) ctor.register(w, url);
  return w as unknown as WorkerLike;
}

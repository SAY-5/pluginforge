// Plugin-side SDK. Plugins run inside a Worker; `host` is a Proxy that
// routes calls through the worker-side RPC transport. The transport itself
// is installed by the sandbox bootstrap before the plugin module loads.

import type { HostApi, PluginLifecycle, PluginHandler } from "./host-api.js";

export interface PluginSdk {
  onActivate: (fn: () => Promise<void> | void) => void;
  onDeactivate: (fn: () => Promise<void> | void) => void;
  registerHandler: (name: string, fn: PluginHandler) => void;
  host: HostApi;
}

interface InternalRuntime {
  call: (method: string, args: unknown[]) => Promise<unknown>;
  lifecycle: PluginLifecycle;
  handlers: Map<string, PluginHandler>;
  events: Map<string, Set<(d: unknown) => void>>;
  emitToHost: (topic: string, data: unknown) => void;
}

declare global {
  // Installed by the sandbox bootstrap before the plugin module is loaded.
  // eslint-disable-next-line no-var
  var __pluginforge_runtime__: InternalRuntime | undefined;
}

function rt(): InternalRuntime {
  const r = globalThis.__pluginforge_runtime__;
  if (!r) {
    throw new Error(
      "pluginforge runtime not installed — are you running inside the sandbox?",
    );
  }
  return r;
}

function buildHost(): HostApi {
  const call = (method: string, args: unknown[]) => rt().call(method, args);
  return {
    ui: {
      notify: (message, opts) =>
        call("ui.notify", [message, opts]) as Promise<void>,
      addCommand: (id, title) =>
        call("ui.addCommand", [id, title]) as Promise<void>,
      registerPanel: (id, title) =>
        call("ui.registerPanel", [id, title]) as Promise<void>,
    },
    commands: {
      register: (id, handlerName) =>
        call("commands.register", [id, handlerName]) as Promise<void>,
    },
    storage: {
      get: <T = unknown>(key: string) =>
        call("storage.get", [key]) as Promise<T | null>,
      put: <T = unknown>(key: string, value: T) =>
        call("storage.put", [key, value]) as Promise<void>,
      del: (key) => call("storage.del", [key]) as Promise<void>,
      list: (prefix) => call("storage.list", [prefix]) as Promise<string[]>,
    },
    net: {
      fetch: (url, init) =>
        call("net.fetch", [url, init]) as Promise<{
          status: number;
          headers: Record<string, string>;
          body: string;
        }>,
    },
    clipboard: {
      read: () => call("clipboard.read", []) as Promise<string>,
      write: (text) => call("clipboard.write", [text]) as Promise<void>,
    },
    env: {
      get: (key) => call("env.get", [key]) as Promise<string | null>,
    },
    shell: {
      run: (cmd, args) =>
        call("shell.run", [cmd, args]) as Promise<{
          stdout: string;
          stderr: string;
          code: number;
        }>,
    },
    events: {
      emit: (topic, data) => {
        rt().emitToHost(topic, data);
        return Promise.resolve();
      },
      on: (topic, handler) => {
        const r = rt();
        let set = r.events.get(topic);
        if (!set) {
          set = new Set();
          r.events.set(topic, set);
        }
        set.add(handler);
        return () => {
          set!.delete(handler);
        };
      },
    },
  };
}

export const plugin: PluginSdk = {
  onActivate(fn) {
    rt().lifecycle.onActivate = fn;
  },
  onDeactivate(fn) {
    rt().lifecycle.onDeactivate = fn;
  },
  registerHandler(name, fn) {
    rt().handlers.set(name, fn);
  },
  host: {} as HostApi,
};

// host is a lazily-built proxy so plugins can import it before the runtime
// has finished installing. Access triggers realization.
const hostProxy: HostApi = new Proxy({} as HostApi, {
  get(_, key) {
    const built = buildHost() as unknown as Record<string, unknown>;
    return built[key as string];
  },
});

// Attach after declaration so a plugin module doing `import { plugin } from
// "@pluginforge/sdk"` sees a fully wired object.
(plugin as { host: HostApi }).host = hostProxy;

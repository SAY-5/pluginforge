// The demo app statically bundles three example plugins using Vite's
// ?raw import to inline their source. This makes the demo work without a
// plugin registry server.

import type { PluginManifest } from "@pluginforge/sdk";

// Load the *compiled* plugin output so type annotations are stripped
// before the source enters a Web Worker. Build the examples first:
// `npm -w @pluginforge-examples/hello-plugin run build` (and the others).
import helloSrc from "../../../examples/hello-plugin/dist/index.js?raw";
import mdSrc from "../../../examples/markdown-plugin/dist/index.js?raw";
import todoSrc from "../../../examples/todo-plugin/dist/index.js?raw";

import helloManifest from "../../../examples/hello-plugin/plugin.json";
import mdManifest from "../../../examples/markdown-plugin/plugin.json";
import todoManifest from "../../../examples/todo-plugin/plugin.json";

export interface DemoPluginDef {
  manifest: PluginManifest;
  bundle: string;
}

function rewriteSdkImports(src: string): string {
  // The SDK import in the source file is "@pluginforge/sdk". Inside the
  // worker sandbox we can't resolve a bare package specifier, so we inline
  // the minimal SDK surface the plugins touch directly.
  return `
    ${MINI_SDK}
    ${src.replace(
      /import\s+{\s*plugin\s*}\s+from\s+["']@pluginforge\/sdk["']\s*;?/,
      "const plugin = __pluginforge_mini_sdk__;",
    )}
  `;
}

const MINI_SDK = String.raw`
const __pluginforge_mini_sdk__ = (() => {
  const rt = self.__pluginforge_runtime__;
  function call(method, args) { return rt.call(method, args); }
  const host = {
    ui: {
      notify: (m, o) => call("ui.notify", [m, o]),
      addCommand: (id, t) => call("ui.addCommand", [id, t]),
      registerPanel: (id, t) => call("ui.registerPanel", [id, t]),
    },
    commands: {
      register: (id, h) => call("commands.register", [id, h]),
    },
    storage: {
      get: (k) => call("storage.get", [k]),
      put: (k, v) => call("storage.put", [k, v]),
      del: (k) => call("storage.del", [k]),
      list: (p) => call("storage.list", [p]),
    },
    net: { fetch: (u, i) => call("net.fetch", [u, i]) },
    clipboard: { read: () => call("clipboard.read", []), write: (t) => call("clipboard.write", [t]) },
    env: { get: (k) => call("env.get", [k]) },
    shell: { run: (c, a) => call("shell.run", [c, a]) },
    events: {
      emit(topic, data) { rt.emitToHost(topic, data); return Promise.resolve(); },
      on(topic, handler) {
        let set = rt.events.get(topic);
        if (!set) { set = new Set(); rt.events.set(topic, set); }
        set.add(handler);
        return () => set.delete(handler);
      },
    },
  };
  return {
    onActivate(fn) { rt.lifecycle.onActivate = fn; },
    onDeactivate(fn) { rt.lifecycle.onDeactivate = fn; },
    registerHandler(name, fn) { rt.handlers.set(name, fn); },
    host,
  };
})();
`;

export const DEMO_PLUGINS: DemoPluginDef[] = [
  { manifest: helloManifest as PluginManifest, bundle: rewriteSdkImports(helloSrc) },
  { manifest: mdManifest as PluginManifest, bundle: rewriteSdkImports(mdSrc) },
  { manifest: todoManifest as PluginManifest, bundle: rewriteSdkImports(todoSrc) },
];

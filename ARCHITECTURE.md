# PluginForge Architecture

## Overview

PluginForge is an extensibility platform: a host app loads third-party plugins,
runs them in Web Worker sandboxes, and exposes a **capability-based** API. A
plugin can only touch what its manifest has been granted — no ambient authority,
no direct DOM access, no `window`, no `fetch` unless the user said yes.

Three packages:

| Package                  | Role                                                       |
|--------------------------|------------------------------------------------------------|
| `@pluginforge/core`      | Host runtime: loader, sandbox, capability grants, RPC      |
| `@pluginforge/sdk`       | Plugin-side typed API (what plugins import)                |
| `@pluginforge/host-app`  | Demo UI: install/enable/disable plugins, grant permissions |

Plus `examples/` with three real plugins demonstrating different capability
surfaces: `hello-plugin` (pure UI), `markdown-plugin` (render + storage),
`todo-plugin` (storage + notifications + net).

## Threat model

A plugin is *untrusted code*. It must not be able to:
- Read or modify the host DOM directly.
- Access `document`, `window`, `localStorage`, `indexedDB`, `fetch`, `navigator`.
- Exfiltrate data (no `fetch` without net capability + destination allowlist).
- Execute code in the host origin (no `eval`-back-into-host channel).
- Starve the host (CPU quota + kill-switch).
- Crash the host (worker failure is isolated).

A plugin *is* allowed to:
- Compute with the inputs the host passes it.
- Maintain its own scoped storage via a capability.
- Call host-provided APIs via typed RPC.
- Expose UI via declarative `UINode` trees the host renders (not raw HTML).

## Plugin package format

A plugin is a directory (or zip) with:

```
plugin.json        # manifest
dist/index.js      # compiled ES module, plugin entry point
dist/index.js.map  # optional source map
icon.png           # optional
README.md          # optional
```

### `plugin.json`

```json
{
  "id": "com.example.markdown",
  "name": "Markdown Renderer",
  "version": "1.2.0",
  "description": "Renders markdown to safe HTML.",
  "author": "Jane Dev",
  "homepage": "https://...",
  "main": "dist/index.js",
  "capabilities": [
    "storage:scoped",
    { "net:fetch": { "allow": ["https://api.example.com/*"] } },
    "ui:panel",
    "command:register"
  ],
  "activationEvents": ["onCommand:md.render", "onFileType:.md"],
  "contributes": {
    "commands": [{ "id": "md.render", "title": "Render markdown" }],
    "panels":   [{ "id": "md.preview", "title": "Markdown Preview" }]
  },
  "hash": "sha256-abc123...",
  "signature": "ed25519-..."
}
```

### Signing

Manifests can be signed. The host maintains a keyring (trusted publisher
ed25519 public keys). Unsigned plugins can still be loaded but carry a
red-outlined "Unsigned" badge in the UI, and certain capabilities
(`net:fetch`, `host:shell`) are only grantable to signed plugins by default
(configurable).

## Sandbox

Each plugin runs in a dedicated Web Worker spawned from a blob URL. The worker
bootstrap code:

1. Overrides/removes dangerous globals: `fetch`, `XMLHttpRequest`,
   `importScripts`, `WebSocket`, `indexedDB`, `caches`, `self.crossOriginIsolated`,
   `Atomics.wait` (DoS vector), `SharedArrayBuffer` (Spectre).
2. Installs the RPC channel (see below).
3. `import()`s the plugin bundle (module worker; no classic `importScripts`).
4. Exposes the plugin's declared exports to the host.

Worker creation:

```ts
const blob = new Blob([BOOTSTRAP_JS], { type: "text/javascript" });
const url = URL.createObjectURL(blob);
const worker = new Worker(url, { type: "module", name: `plugin:${id}` });
```

The plugin bundle is delivered to the worker *post-construction* over the RPC
channel, not via `importScripts`, so it cannot reach out for arbitrary URLs.

### CPU quota

A watchdog in the host pings each plugin every 500ms with a heartbeat. If a
plugin fails to respond within 2s (running hot, stuck in a loop), the host
sends `worker.terminate()` and marks the plugin crashed. The UI shows a
"Restart" button.

Per-plugin CPU time is tracked via a before/after heartbeat delta. A plugin
exceeding 80% CPU for 10s emits a warning surfaced to the user.

### Memory quota

`performance.measureUserAgentSpecificMemory()` (where available) is sampled
every 10s. Plugins over a configurable threshold (default 128 MB) are paused
and surfaced for user action.

## Capability system

### Capability descriptors

Capabilities are strings or `{ name, params }` objects. Built-in set:

| Capability             | Params                         | What it grants                              |
|------------------------|--------------------------------|---------------------------------------------|
| `storage:scoped`       | `{ quotaMB?: number }`         | Plugin-scoped KV + blob store               |
| `net:fetch`            | `{ allow: string[] }`          | `fetch()` limited to matching URL patterns  |
| `ui:panel`             | —                              | Contribute one or more panels to host UI    |
| `ui:command`           | —                              | Register commands in command palette        |
| `ui:notify`            | —                              | Show toast notifications                    |
| `clipboard:read`       | —                              | Read clipboard                              |
| `clipboard:write`      | —                              | Write clipboard                             |
| `host:env`             | `{ keys: string[] }`           | Read specific env vars (allow-listed)       |
| `host:shell`           | `{ allow: string[] }`          | Invoke shell commands matching patterns     |

### Grant flow

1. Plugin installs → host reads manifest.
2. For each declared capability, host checks `grants` DB:
   - Previously granted and not revoked → auto-allow.
   - Never granted → prompt user with plain-language summary (“This plugin
     wants to: store data, fetch from `api.example.com`.”).
   - User can **Allow once**, **Allow always**, **Deny**.
3. Granted capabilities are bound into the plugin's RPC surface.

The grant store is persisted in `localStorage` (host-app) or provided by the
embedder.

### Enforcement

Capabilities are enforced **at the RPC boundary**, not in the worker. The
worker's `request("net.fetch", {...})` is routed through the host's
`CapabilityRouter`, which matches against the plugin's granted caps + params
*before* invoking the real `fetch`. A plugin that pretends to have a
capability it wasn't granted will just see `PermissionDenied` errors.

## RPC protocol

Typed bidirectional request/response + event streams over `postMessage`.

```ts
// request
{ kind: "req", id: number, method: string, args: unknown[] }
// response
{ kind: "res", id: number, ok: true, value: unknown }
{ kind: "res", id: number, ok: false, error: { code: string, message: string } }
// event
{ kind: "evt", topic: string, data: unknown }
// cancel
{ kind: "cancel", id: number }
```

Types: methods and events are declared in `@pluginforge/sdk` as a TypeScript
interface; codegen produces the host-side router stubs.

Cancellation uses `AbortController` pattern: each RPC gets a signal derived
from the client-side request; `cancel` messages resolve the signal.

### SDK shape (plugin-facing)

```ts
import { plugin, host } from "@pluginforge/sdk";

plugin.onActivate(async () => {
  await host.ui.notify("Hello!");

  const items = await host.storage.list();
  host.commands.register("todo.add", async (title: string) => {
    const id = crypto.randomUUID();
    await host.storage.put(id, { title, done: false });
    host.events.emit("todo.changed", { id });
  });
});
```

## Host app

A small React/Vite demo UI that showcases the core runtime. Panels:

1. **Installed** — list of plugins, enable/disable, reveal-in-folder, uninstall.
2. **Store** (stub) — browse example plugins from the `examples/` directory.
3. **Grants** — per-plugin capability table; revoke individual caps.
4. **Console** — live log stream from plugin workers (filterable, searchable).
5. **Commands** — command palette (cmd-k) showing registered commands across plugins.

The host app is a *reference embedding*. Real consumers (e.g. an IDE, a CMS)
embed `@pluginforge/core` directly and provide their own UI.

## Testing

- **Sandbox isolation tests**: spawn a worker, try `fetch()`, `localStorage`,
  `indexedDB`, etc. — all must throw or be undefined.
- **Capability enforcement tests**: spawn a plugin without `net:fetch`,
  call `host.net.fetch(...)`, assert `PermissionDenied`.
- **RPC protocol tests**: happy path, cancel, error propagation, reentrancy.
- **Watchdog tests**: stuck plugin is terminated within SLA.
- **Signature verification tests**: valid, invalid, revoked, unknown signer.

Tests run under jsdom + miniflare-style Worker polyfill; real browser tests via
Playwright for host-app.

## Security notes (non-exhaustive)

- The worker bootstrap is *inlined* (no network load) to prevent MITM on the
  sandbox itself.
- Plugin bundles must parse as ES modules; `new Function(...)`,
  `WebAssembly.instantiate` with arbitrary imports, and eval are available in
  the worker (JS spec can't strip them without CSP) but host-imposed CSP on
  the worker blob URL mitigates exfiltration vectors.
- `net:fetch` allow-list is URL-glob: `https://api.example.com/*`. Wildcards
  only in path, not in scheme/host. A host that ignores this rule on a
  security-sensitive deployment can tighten to exact-URL.

## CI

GitHub Actions: lint, typecheck, unit tests, Playwright headless for host-app.
Matrix Node 20/22.

## Non-goals

- No native code / WASM runtime isolation beyond what Worker gives you.
- No process-level isolation (Workers are in-process threads, not OS processes).
  Embedders needing that can run the host in an iframe with `sandbox` attributes.
- No auto-update infrastructure — handled by the embedder.

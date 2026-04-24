# PluginForge

[![ci](https://github.com/SAY-5/pluginforge/actions/workflows/ci.yml/badge.svg)](https://github.com/SAY-5/pluginforge/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-33%20passing-brightgreen)](#)
[![sandbox escape tests](https://img.shields.io/badge/escape_tests-12-4fe3b0)](#)

Extensibility platform with **WebWorker-sandboxed plugin runtime** and
**capability-based permissions**. Plugins run in a hardened worker with no
ambient authority — every host capability is gated by a manifest declaration
and a user grant, enforced at the RPC boundary.

- **Hardened sandbox** — fetch, XHR, localStorage, indexedDB, WebSocket,
  document, window, SharedArrayBuffer, Atomics are all killed inside the
  worker. importScripts is disabled.
- **Capability router** — storage, net, ui, clipboard, env, shell; URL
  allow-lists with wildcard paths; per-key env lists; glob-matched shell
  commands.
- **Typed SDK** — plugins write `plugin.onActivate(() => plugin.host.storage.put(...))`,
  fully typed.
- **Three example plugins** — hello, markdown, todo — demonstrating
  increasing capability surface.
- **Reference host app** — React/Vite UI with plugin list, capability
  display, command palette (⌘K), live log console.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for threat model, capability spec,
and protocol.

## Quick start

```bash
npm install
npm run build
npm run dev   # host app on :5174
```

Open http://localhost:5174. Three demo plugins load automatically. Press
⌘K / Ctrl+K to invoke their commands.

## Package layout

```
packages/
  sdk/          @pluginforge/sdk        — plugin-side API + types
  core/         @pluginforge/core       — host runtime (sandbox, router)
  host-app/     @pluginforge/host-app   — demo UI
examples/
  hello-plugin/
  markdown-plugin/
  todo-plugin/
```

## Writing a plugin

```ts
import { plugin } from "@pluginforge/sdk";

plugin.onActivate(async () => {
  await plugin.host.ui.addCommand("mytool.run", "Run my tool");
  plugin.registerHandler("mytool.run", async () => {
    const key = "counter";
    const prev = ((await plugin.host.storage.get<number>(key)) ?? 0) as number;
    await plugin.host.storage.put(key, prev + 1);
    await plugin.host.ui.notify(`ran ${prev + 1} times`);
  });
});
```

Minimal `plugin.json`:

```json
{
  "id": "com.example.mytool",
  "name": "My Tool",
  "version": "1.0.0",
  "main": "dist/index.js",
  "capabilities": ["storage:scoped", "ui:command", "ui:notify"]
}
```

## Capabilities

| Capability         | What it grants                                  |
|--------------------|-------------------------------------------------|
| `storage:scoped`   | Plugin-scoped KV store                          |
| `net:fetch`        | `fetch()` limited to URL allow-list             |
| `ui:panel`         | Contribute host panels                          |
| `ui:command`       | Register commands                               |
| `ui:notify`        | Show toast notifications                        |
| `clipboard:read`   | Read clipboard                                  |
| `clipboard:write`  | Write clipboard                                 |
| `host:env`         | Read specific env vars (allow-listed)           |
| `host:shell`       | Invoke shell commands matching patterns         |

See [packages/sdk/src/capabilities.ts](packages/sdk/src/capabilities.ts) for
the exact shape.

## Testing

```
npm test
```

Runs capability-router, URL-match, and sandbox host lifecycle tests (16
tests across three files).

## Companion projects

Part of a five-repo set:

- **[canvaslive](https://github.com/SAY-5/canvaslive)** — real-time multiplayer whiteboard with operational-transform convergence.
- **[pluginforge](https://github.com/SAY-5/pluginforge)** — you're here. Sandboxed plugin runtime.
- **[agentlab](https://github.com/SAY-5/agentlab)** — multi-model AI coding agent evaluation harness.
- **[payflow](https://github.com/SAY-5/payflow)** — Spring Boot payments API with idempotent transactions and Stripe webhooks.
- **[queryflow](https://github.com/SAY-5/queryflow)** — natural-language SQL engine with pgvector RAG.

## License

MIT — see [LICENSE](./LICENSE).

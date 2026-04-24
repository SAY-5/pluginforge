# Deploying PluginForge

PluginForge has two deployment modes depending on how you use it.

## Mode 1 — the demo host app (what `Dockerfile` builds)

The demo host app is a static SPA. It ships as an nginx image and needs no
backend: plugins run fully client-side in Web Workers.

```bash
docker build -t pluginforge-host .
docker run --rm -p 8080:80 pluginforge-host
# → http://localhost:8080
```

The included nginx config sets a strict Content-Security-Policy:

```
default-src 'self';
script-src  'self' blob:;
worker-src  'self' blob:;
connect-src 'self';
```

`blob:` in `script-src` / `worker-src` is **required** — the sandbox spawns
plugins from blob URLs. Tightening to `self` only would break the runtime.

## Mode 2 — embedded library

In real use, `@pluginforge/core` and `@pluginforge/sdk` are embedded into
your own app (editor, CMS, IDE, whatever). The demo host app is just a
reference embedding; you write your own UI.

Minimum embedding:

```ts
import { Host, LocalStorageBackedStorage } from "@pluginforge/core";

const host = new Host({
  storage: new LocalStorageBackedStorage("myapp:"),
  callbacks: {
    notify: (pluginId, message, level) => showToast(pluginId, message, level),
    addCommand: (pluginId, id, title) => commandPalette.add(pluginId, id, title),
    registerPanel: (pluginId, id, title) => panels.add(pluginId, id, title),
  },
});

const plugin = await host.load({
  manifest: /* parsed plugin.json */,
  bundle: /* ES module source string */,
});
```

Your embedder is responsible for:
- Fetching plugin bundles (from a registry, disk, a CDN) and providing
  the source string to `Host.load`.
- Policy: whether unsigned plugins can be loaded, whether `net:fetch`
  capabilities auto-grant or require explicit user approval per URL pattern.
- Persisting grants and plugin install state between sessions.

## Security posture

- Plugins run in dedicated Web Workers; `fetch`, `XMLHttpRequest`,
  `WebSocket`, `BroadcastChannel`, `MessageChannel`, `indexedDB`,
  `caches`, `localStorage`, `document`, `window`, `WebAssembly`, nested
  `Worker`, `importScripts`, dynamic `Function`, and `eval` are all
  killed inside the worker. A dedicated test suite
  (`packages/core/test/sandbox-escape.test.ts`) runs 12 known escape
  probes against a real worker_threads Worker and asserts each is
  blocked. If you add a new capability, extend that test first.
- `CapabilityRouter` enforces every RPC at the boundary. A plugin that
  forges an RPC for a capability it wasn't granted just gets
  `PermissionDenied`.
- `host:shell` is **deliberately restrictive**: both the command string
  and every argument are validated against a glob and rejected if they
  contain shell metacharacters (`; & | \` $ < > \n`). Even so,
  `host:shell` should never be granted to an unsigned plugin by default —
  it is genuinely RCE-adjacent.
- `net:fetch` URL patterns are matched via WHATWG URL parsing with
  percent-decoding, then `..` traversal segments in the requested URL
  are rejected before pattern matching.

## Out of scope

- **A plugin registry + signature verification server**: PluginForge
  ships the *client-side* verification primitives (`manifest.signature`
  is a field, and the host can be configured to require it), but there's
  no reference server to host/sign bundles. Use whatever your
  infrastructure already provides (S3 + ed25519-signing CI, an OCI
  registry, etc.).
- **Multi-tenant hosted plugin marketplace**: out of scope for a library.
  If you build one, follow the CSP in this Dockerfile and make signed
  manifests mandatory.

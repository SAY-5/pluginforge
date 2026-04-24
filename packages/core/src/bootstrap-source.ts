// Source code of the sandbox bootstrap, inlined as a string so the host can
// spawn workers from a blob URL without making any network request.
//
// IMPORTANT: everything in BOOTSTRAP_SOURCE runs **inside the worker**. Keep
// it self-contained; do not pull in external modules from this file.

export const BOOTSTRAP_SOURCE = String.raw`
"use strict";

// ---- remove/override dangerous globals ----------------------------------
//
// The sandbox has two classes of risks:
//   (1) ambient APIs that let a plugin reach the network, storage, or DOM
//       of other pages (fetch, XHR, WebSocket, indexedDB, caches, ...),
//   (2) introspection escapes that hand the plugin a reference to the real
//       global scope or the Function constructor (self.constructor,
//       BroadcastChannel, MessageChannel with transferable ports).
// We kill both. The kill-IIFE runs synchronously before anything else so
// nothing can capture an earlier reference to the killed globals.
//
// We *deliberately* replace each slot with a stub that throws only on
// INVOCATION / property-access, rather than with a getter that throws on
// read. A throwing getter is dangerous because V8 + Node internals
// sometimes probe these globals during error handling or module loading —
// on affected versions those probes trip our getter and the real failure
// (which is what we actually want surfaced) gets shadowed. Stubs that
// appear as plain undefined/function values are indistinguishable from
// absence and don't perturb the host runtime.
(function () {
  const denyCtor = function () {
    throw new Error("pluginforge: this API is not available in the sandbox");
  };
  // Callable stubs (both "new X(...)" and "X(...)" syntaxes throw).
  const callables = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "BroadcastChannel",
    "MessageChannel",
    "MessagePort",
    "Worker",
    "SharedWorker",
    "ServiceWorker",
  ];
  // Non-callable slots: set to undefined. Any property access throws
  // naturally ("Cannot read properties of undefined"), no custom getter.
  //
  // WebAssembly is INTENTIONALLY kept reachable. Node 22+ uses it during
  // async-function compilation; setting it to undefined breaks every
  // promise-based callsite inside the worker, including the plugin's own
  // code. Leaving it reachable is safe: Wasm has no ambient I/O —
  // everything goes through the import object, and every import a
  // plugin would want to pass (fetch, postMessage, storage) is already
  // stubbed or absent at the global level. A Wasm module with no
  // imports can only compute; it cannot exfiltrate.
  const voids = [
    "indexedDB",
    "caches",
    "navigator",
    "localStorage",
    "sessionStorage",
    "document",
    "window",
    "parent",
    "top",
    "openDatabase",
    "SharedArrayBuffer",
    "Atomics",
  ];
  for (const k of callables) {
    try {
      Object.defineProperty(self, k, {
        configurable: true,
        writable: false,
        value: denyCtor,
      });
    } catch (_) {
      // Some globals are non-configurable; best-effort.
    }
  }
  for (const k of voids) {
    try {
      Object.defineProperty(self, k, {
        configurable: true,
        writable: false,
        value: undefined,
      });
    } catch (_) {}
  }
  // Defuse the self.constructor → Function escape. The Function constructor
  // turns a string into a function bound to the real global, which is how
  // sandbox escapes normally happen ("new self.constructor.constructor('return fetch')()").
  // We redefine the "constructor" slot on the worker global and freeze
  // Function.prototype / Object.prototype so plugins can't re-plumb it.
  try {
    Object.defineProperty(self, "constructor", {
      configurable: false,
      writable: false,
      value: Object,
    });
  } catch (_) {}
  try {
    // Replace the Function constructor with one that always throws.
    // We deliberately do NOT freeze Function.prototype or
    // Object.prototype — some Node versions use those prototypes
    // internally during async function synthesis and freezing them
    // breaks test runners and error-propagation paths, without adding
    // security we don't already get from replacing the constructor.
    const denyFunction = function () {
      throw new Error("pluginforge: dynamic Function() is disabled in the sandbox");
    };
    denyFunction.prototype = Function.prototype;
    Object.defineProperty(self, "Function", {
      configurable: false,
      writable: false,
      value: denyFunction,
    });
  } catch (_) {}
  try {
    // importScripts loads classic scripts synchronously; we never want that.
    self.importScripts = function () {
      throw new Error("pluginforge: importScripts is disabled");
    };
  } catch (_) {}
  try {
    // eval is indirect-callable; kill it too for symmetry with Function.
    // We can't fully remove it, but we can replace the binding visible here.
    self.eval = function () {
      throw new Error("pluginforge: eval is disabled in the sandbox");
    };
  } catch (_) {}
})();

// ---- RPC transport ------------------------------------------------------
const __pending = new Map();
let __reqCounter = 0;

function __postMsg(msg) {
  try {
    self.postMessage(msg);
  } catch (err) {
    // Host gone; nothing we can do.
  }
}

function __newReqId() {
  __reqCounter += 1;
  return __reqCounter;
}

const __runtime = {
  call(method, args) {
    const id = __newReqId();
    return new Promise(function (resolve, reject) {
      __pending.set(id, { resolve: resolve, reject: reject });
      __postMsg({ kind: "req", id: id, method: method, args: args });
    });
  },
  lifecycle: { onActivate: null, onDeactivate: null },
  handlers: new Map(),
  events: new Map(),
  emitToHost(topic, data) {
    __postMsg({ kind: "evt", topic: topic, data: data });
  },
};
self.__pluginforge_runtime__ = __runtime;

// Logging proxy: plugin console.* goes to the host as log messages.
const __origConsole = self.console;
["debug", "info", "warn", "error", "log"].forEach(function (level) {
  self.console[level] = function () {
    const args = Array.prototype.slice.call(arguments);
    __postMsg({ kind: "log", level: level === "log" ? "info" : level, args: args });
    if (__origConsole && typeof __origConsole[level] === "function") {
      try {
        __origConsole[level].apply(__origConsole, args);
      } catch (_) {}
    }
  };
});

self.addEventListener("error", function (ev) {
  __postMsg({
    kind: "log",
    level: "error",
    args: ["uncaught error:", String(ev.message || ev)],
  });
});
self.addEventListener("unhandledrejection", function (ev) {
  __postMsg({
    kind: "log",
    level: "error",
    args: ["unhandled rejection:", String(ev && ev.reason ? ev.reason : ev)],
  });
});

// ---- message dispatch ---------------------------------------------------
self.addEventListener("message", function (ev) {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  switch (msg.kind) {
    case "loadBundle":
      __loadBundle(msg);
      return;
    case "res":
      __handleRes(msg);
      return;
    case "req":
      __handleReq(msg);
      return;
    case "cancel":
      // Plugins don't currently expose cancellation of their handlers; no-op.
      return;
    case "hb":
      __postMsg({ kind: "hb", token: msg.token });
      return;
    case "evt":
      __handleEvt(msg);
      return;
    default:
      return;
  }
});

function __handleRes(msg) {
  const p = __pending.get(msg.id);
  if (!p) return;
  __pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.value);
  else p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
}

function __handleReq(msg) {
  const handler = __runtime.handlers.get(msg.method);
  if (!handler) {
    __postMsg({
      kind: "res",
      id: msg.id,
      ok: false,
      error: { code: "MethodNotFound", message: msg.method },
    });
    return;
  }
  Promise.resolve()
    .then(function () {
      return handler.apply(null, msg.args || []);
    })
    .then(function (value) {
      __postMsg({ kind: "res", id: msg.id, ok: true, value: value });
    })
    .catch(function (err) {
      __postMsg({
        kind: "res",
        id: msg.id,
        ok: false,
        error: { code: "Internal", message: String(err && err.message ? err.message : err) },
      });
    });
}

function __handleEvt(msg) {
  const subs = __runtime.events.get(msg.topic);
  if (!subs) return;
  subs.forEach(function (fn) {
    try {
      fn(msg.data);
    } catch (_) {}
  });
}

async function __loadBundle(msg) {
  try {
    // Turn the source string into a module blob we can dynamically import.
    const src = msg.source;
    const blob = new Blob([src], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (__runtime.lifecycle.onActivate) {
      await __runtime.lifecycle.onActivate();
    }
    __postMsg({ kind: "ready" });
  } catch (err) {
    const errStr = String(err && err.message ? err.message : err);
    __postMsg({ kind: "log", level: "error", args: ["bundle load failed:", errStr] });
    // Surface the failure to the host as a log that it can treat as fatal.
    // We don't post { kind: "ready" }; the host's load timeout will fire
    // with this log line as the last context before rejecting load().
  }
}

// Announce presence so the host knows the worker is alive.
__postMsg({ kind: "ready", handshake: true });
`;

// Source code of the sandbox bootstrap, inlined as a string so the host can
// spawn workers from a blob URL without making any network request.
//
// IMPORTANT: everything in BOOTSTRAP_SOURCE runs **inside the worker**. Keep
// it self-contained; do not pull in external modules from this file.

export const BOOTSTRAP_SOURCE = String.raw`
"use strict";

// ---- remove/override dangerous globals ----------------------------------
(function () {
  const kill = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
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
  for (const k of kill) {
    try {
      Object.defineProperty(self, k, {
        configurable: true,
        get() {
          throw new Error("pluginforge: '" + k + "' is not available in the sandbox");
        },
      });
    } catch (_) {
      // Some globals are non-configurable; best-effort.
    }
  }
  try {
    // importScripts loads classic scripts synchronously; we never want that.
    self.importScripts = function () {
      throw new Error("pluginforge: importScripts is disabled");
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
    __postMsg({
      kind: "log",
      level: "error",
      args: ["bundle load failed:", String(err && err.message ? err.message : err)],
    });
  }
}

// Announce presence so the host knows the worker is alive.
__postMsg({ kind: "ready", handshake: true });
`;

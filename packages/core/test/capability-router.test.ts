import { describe, expect, it } from "vitest";
import {
  CapabilityRouter,
  PermissionDeniedError,
} from "../src/capability-router.js";
import type { Capability } from "@pluginforge/sdk";

describe("CapabilityRouter.authorize", () => {
  it("permits storage methods when storage:scoped is granted", () => {
    const r = new CapabilityRouter([{ name: "storage:scoped" }]);
    expect(() => r.authorize("storage.get", ["k"])).not.toThrow();
    expect(() => r.authorize("storage.put", ["k", 1])).not.toThrow();
  });

  it("denies storage.get without capability", () => {
    const r = new CapabilityRouter([]);
    expect(() => r.authorize("storage.get", ["k"])).toThrowError(PermissionDeniedError);
  });

  it("net.fetch: allows matching url, denies others", () => {
    const caps: Capability[] = [
      { name: "net:fetch", params: { allow: ["https://api.example.com/*"] } },
    ];
    const r = new CapabilityRouter(caps);
    expect(() => r.authorize("net.fetch", ["https://api.example.com/v1/ping"])).not.toThrow();
    expect(() => r.authorize("net.fetch", ["https://evil.example.com/v1/ping"])).toThrowError(
      PermissionDeniedError,
    );
    expect(() => r.authorize("net.fetch", ["http://api.example.com/v1/ping"])).toThrowError();
  });

  it("env.get: allow-list enforced per key", () => {
    const caps: Capability[] = [
      { name: "host:env", params: { keys: ["FOO"] } },
    ];
    const r = new CapabilityRouter(caps);
    expect(() => r.authorize("env.get", ["FOO"])).not.toThrow();
    expect(() => r.authorize("env.get", ["PATH"])).toThrowError(PermissionDeniedError);
  });

  it("shell.run: glob patterns", () => {
    const caps: Capability[] = [
      { name: "host:shell", params: { allow: ["ls", "echo *"] } },
    ];
    const r = new CapabilityRouter(caps);
    expect(() => r.authorize("shell.run", ["ls", []])).not.toThrow();
    expect(() => r.authorize("shell.run", ["echo hi", []])).not.toThrow();
    expect(() => r.authorize("shell.run", ["rm -rf /", []])).toThrowError();
  });

  it("unknown method is refused", () => {
    const r = new CapabilityRouter([{ name: "ui:notify" }]);
    expect(() => r.authorize("bogus.method", [])).toThrow();
  });

  it("string-only capability forms default to zero-grant for param-requiring caps", () => {
    const r = new CapabilityRouter(["net:fetch"]);
    // We have the cap name, but allow-list is empty.
    expect(() => r.authorize("net.fetch", ["https://example.com"])).toThrowError(
      PermissionDeniedError,
    );
  });
});

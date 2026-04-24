/**
 * Microbenchmarks for the CapabilityRouter hot path.
 *
 * The router is called on every plugin→host RPC, so its per-call cost
 * directly bounds RPC throughput.
 */

import { bench, describe } from "vitest";
import {
  CapabilityRouter,
} from "../src/capability-router.js";
import { matchUrlPattern } from "@pluginforge/sdk";

describe("CapabilityRouter.authorize", () => {
  const routerWithFetch = new CapabilityRouter([
    { name: "net:fetch", params: { allow: ["https://api.example.com/*", "https://cdn.example.com/*"] } },
    { name: "storage:scoped" },
    { name: "ui:notify" },
  ]);
  const routerWithShell = new CapabilityRouter([
    { name: "host:shell", params: { allow: ["git status", "git diff *", "echo *"] } },
  ]);

  bench("ui.notify (most-common call)", () => {
    routerWithFetch.authorize("ui.notify", ["hi"]);
  });

  bench("storage.get (second most common)", () => {
    routerWithFetch.authorize("storage.get", ["key:1"]);
  });

  bench("net.fetch with allowed URL", () => {
    routerWithFetch.authorize("net.fetch", ["https://api.example.com/v1/ping"]);
  });

  bench("shell.run with validated args", () => {
    routerWithShell.authorize("shell.run", ["git", ["status"]]);
  });
});

describe("matchUrlPattern", () => {
  bench("exact host+path match", () => {
    matchUrlPattern("https://api.example.com/v1/ping", "https://api.example.com/v1/ping");
  });
  bench("wildcard path match", () => {
    matchUrlPattern("https://api.example.com/*", "https://api.example.com/v1/endpoint/deeply/nested");
  });
  bench("host mismatch rejection", () => {
    matchUrlPattern("https://api.example.com/*", "https://evil.example.net/foo");
  });
  bench("traversal rejection", () => {
    matchUrlPattern("https://api.example.com/*", "https://api.example.com/a/../b");
  });
});

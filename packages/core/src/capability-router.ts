import {
  type Capability,
  capabilityName,
  ErrorCodes,
  matchUrlPattern,
} from "@pluginforge/sdk";

export class PermissionDeniedError extends Error {
  readonly code = ErrorCodes.PermissionDenied;
  constructor(msg: string) {
    super(msg);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Per-plugin capability matcher. The router doesn't execute capabilities
 * itself — it just answers the question "may this plugin call this RPC
 * method with these args?".
 */
export class CapabilityRouter {
  private readonly caps: Capability[];

  constructor(caps: ReadonlyArray<Capability | string>) {
    this.caps = caps.map(normalize);
  }

  hasName(name: string): boolean {
    return this.caps.some((c) => c.name === name);
  }

  /** Throws if denied. Returns normally on success. */
  authorize(method: string, args: unknown[]): void {
    switch (method) {
      case "storage.get":
      case "storage.put":
      case "storage.del":
      case "storage.list":
        this.require("storage:scoped", method);
        return;

      case "net.fetch": {
        this.require("net:fetch", method);
        const url = firstString(args);
        if (!url) throw new PermissionDeniedError(`${method}: url required`);
        const cap = this.caps.find((c) => c.name === "net:fetch");
        if (!cap) throw new PermissionDeniedError("no net:fetch capability");
        const allow = cap.name === "net:fetch" ? cap.params.allow : [];
        if (!allow.some((p) => matchUrlPattern(p, url))) {
          throw new PermissionDeniedError(
            `net:fetch: ${url} not in allow-list`,
          );
        }
        return;
      }

      case "ui.notify":
        this.require("ui:notify", method);
        return;

      case "ui.addCommand":
      case "commands.register":
        this.require("ui:command", method);
        return;

      case "ui.registerPanel":
        this.require("ui:panel", method);
        return;

      case "clipboard.read":
        this.require("clipboard:read", method);
        return;

      case "clipboard.write":
        this.require("clipboard:write", method);
        return;

      case "env.get": {
        this.require("host:env", method);
        const key = firstString(args);
        const cap = this.caps.find((c) => c.name === "host:env");
        if (!key || !cap || cap.name !== "host:env" || !cap.params.keys.includes(key)) {
          throw new PermissionDeniedError(`env.get: '${key}' not in allow-list`);
        }
        return;
      }

      case "shell.run": {
        this.require("host:shell", method);
        const cmd = firstString(args);
        const cap = this.caps.find((c) => c.name === "host:shell");
        const allow = cap && cap.name === "host:shell" ? cap.params.allow : [];
        if (!cmd || !allow.some((p) => simpleGlob(p, cmd))) {
          throw new PermissionDeniedError(`shell.run: '${cmd}' not permitted`);
        }
        return;
      }

      default:
        throw new Error(
          `CapabilityRouter: unknown method '${method}' — refusing to authorize`,
        );
    }
  }

  private require(name: string, method: string): void {
    if (!this.hasName(name)) {
      throw new PermissionDeniedError(
        `${method}: plugin lacks '${name}' capability`,
      );
    }
  }
}

function normalize(c: Capability | string): Capability {
  if (typeof c !== "string") return c;
  const name = capabilityName(c);
  // String-only forms default to empty params where required; policies that
  // require params (net:fetch, host:env, host:shell) effectively grant
  // nothing until the user tightens them.
  switch (name) {
    case "storage:scoped":
      return { name: "storage:scoped" };
    case "net:fetch":
      return { name: "net:fetch", params: { allow: [] } };
    case "ui:panel":
      return { name: "ui:panel" };
    case "ui:command":
      return { name: "ui:command" };
    case "ui:notify":
      return { name: "ui:notify" };
    case "clipboard:read":
      return { name: "clipboard:read" };
    case "clipboard:write":
      return { name: "clipboard:write" };
    case "host:env":
      return { name: "host:env", params: { keys: [] } };
    case "host:shell":
      return { name: "host:shell", params: { allow: [] } };
    default:
      throw new Error(`unknown capability '${name}'`);
  }
}

function firstString(args: unknown[]): string | null {
  const a = args[0];
  return typeof a === "string" ? a : null;
}

function simpleGlob(pattern: string, s: string): boolean {
  if (!pattern.includes("*")) return pattern === s;
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*") +
      "$",
  );
  return re.test(s);
}

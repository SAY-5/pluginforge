// Capability descriptors. Plugins declare these in plugin.json; the host
// grants them per-plugin and enforces at the RPC boundary.

export type CapabilityName =
  | "storage:scoped"
  | "net:fetch"
  | "ui:panel"
  | "ui:command"
  | "ui:notify"
  | "clipboard:read"
  | "clipboard:write"
  | "host:env"
  | "host:shell";

export type Capability =
  | { name: "storage:scoped"; params?: { quotaMB?: number } }
  | { name: "net:fetch"; params: { allow: string[] } }
  | { name: "ui:panel" }
  | { name: "ui:command" }
  | { name: "ui:notify" }
  | { name: "clipboard:read" }
  | { name: "clipboard:write" }
  | { name: "host:env"; params: { keys: string[] } }
  | { name: "host:shell"; params: { allow: string[] } };

export function capabilityName(c: Capability | CapabilityName | string): CapabilityName {
  if (typeof c === "string") {
    // Tolerate either "net:fetch" alone or {name:"net:fetch", params}.
    if (c.startsWith("{")) {
      try {
        const parsed = JSON.parse(c) as Capability;
        return parsed.name;
      } catch {
        return c as CapabilityName;
      }
    }
    return c as CapabilityName;
  }
  return c.name;
}

export function humanizeCapability(c: Capability | CapabilityName): string {
  const n = typeof c === "string" ? c : c.name;
  switch (n) {
    case "storage:scoped":
      return "Store data privately for this plugin";
    case "net:fetch": {
      const allow = typeof c === "object" && c.name === "net:fetch" ? c.params.allow : [];
      return allow.length > 0
        ? `Fetch from: ${allow.join(", ")}`
        : "Fetch from any URL";
    }
    case "ui:panel":
      return "Show panels in the host UI";
    case "ui:command":
      return "Register commands in the command palette";
    case "ui:notify":
      return "Show toast notifications";
    case "clipboard:read":
      return "Read the clipboard";
    case "clipboard:write":
      return "Write to the clipboard";
    case "host:env": {
      const keys = typeof c === "object" && c.name === "host:env" ? c.params.keys : [];
      return `Read env vars: ${keys.join(", ") || "(none listed)"}`;
    }
    case "host:shell": {
      const allow = typeof c === "object" && c.name === "host:shell" ? c.params.allow : [];
      return `Run shell commands matching: ${allow.join(", ") || "(none listed)"}`;
    }
    default:
      return n;
  }
}

/** Match a URL pattern with * as a wildcard. Only path wildcards allowed. */
export function matchUrlPattern(pattern: string, url: string): boolean {
  // Split scheme://host[:port]/rest
  const m = /^([a-z]+):\/\/([^/]+)(\/.*)?$/.exec(pattern);
  const u = /^([a-z]+):\/\/([^/]+)(\/.*)?$/.exec(url);
  if (!m || !u) return false;
  if (m[1] !== u[1]) return false; // scheme must match exactly
  if (m[2] !== u[2]) return false; // host (and port) must match exactly
  const pPath = m[3] ?? "/";
  const uPath = u[3] ?? "/";
  if (!pPath.includes("*")) return pPath === uPath;
  // Regex from pattern: escape regex meta, turn * into [^\s]*
  const re = new RegExp(
    "^" +
      pPath
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^\\s]*") +
      "$",
  );
  return re.test(uPath);
}

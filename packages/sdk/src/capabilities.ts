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

/** Match a URL pattern with `*` as a wildcard. Only path wildcards allowed. */
export function matchUrlPattern(pattern: string, url: string): boolean {
  // Parse + normalize both sides with the URL API so percent-encoding and
  // relative path segments ("..", ".", repeated slashes) can't smuggle past
  // an otherwise-strict allow-list.
  let pUrl: URL, uUrl: URL;
  try {
    pUrl = new URL(pattern);
    uUrl = new URL(url);
  } catch {
    return false;
  }
  if (pUrl.protocol !== uUrl.protocol) return false;
  if (pUrl.host !== uUrl.host) return false;
  const pPath = pUrl.pathname || "/";
  const uPath = uUrl.pathname || "/";
  // After URL normalization, ".." / "." in the requested URL have already
  // been resolved. But a pattern author may want to allow traversal-free
  // paths only — reject any requested path whose *original* string encodes
  // a traversal segment.
  if (/(^|\/)\.\.(\/|$)/.test(url)) return false;
  if (!pPath.includes("*")) return pPath === uPath;
  // `*` matches any path characters (including `/`) so a pattern like
  // `https://api.example.com/*` covers the whole subtree. Traversal
  // segments (`..`) are rejected above, and percent-decoding by `new URL`
  // normalizes the path before this matcher sees it.
  const re = new RegExp(
    "^" +
      pPath
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*") +
      "$",
  );
  return re.test(uPath);
}

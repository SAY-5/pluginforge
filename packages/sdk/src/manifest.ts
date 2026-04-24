import type { Capability, CapabilityName } from "./capabilities.js";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main: string;
  capabilities: Array<Capability | CapabilityName>;
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{ id: string; title: string }>;
    panels?: Array<{ id: string; title: string }>;
  };
  hash?: string;
  signature?: string;
}

export function validateManifest(m: unknown): PluginManifest {
  if (!m || typeof m !== "object") throw new Error("manifest must be an object");
  const o = m as Record<string, unknown>;
  requireString(o, "id");
  requireString(o, "name");
  requireString(o, "version");
  requireString(o, "main");
  if (!Array.isArray(o.capabilities)) {
    throw new Error("manifest.capabilities must be an array");
  }
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(o.id as string)) {
    throw new Error(`manifest.id '${o.id}' must be a reverse-dns style identifier`);
  }
  if (!/^\d+\.\d+\.\d+/.test(o.version as string)) {
    throw new Error(`manifest.version '${o.version}' must be semver`);
  }
  return m as PluginManifest;
}

function requireString(o: Record<string, unknown>, key: string): void {
  if (typeof o[key] !== "string" || (o[key] as string).length === 0) {
    throw new Error(`manifest.${key} must be a non-empty string`);
  }
}

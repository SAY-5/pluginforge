// Plugin-scoped storage abstraction. Implementations can persist to
// localStorage, IndexedDB, or server-side; the host provides the
// implementation; core only defines the interface.

export interface PluginStorage {
  get(pluginId: string, key: string): Promise<unknown>;
  put(pluginId: string, key: string, value: unknown): Promise<void>;
  del(pluginId: string, key: string): Promise<void>;
  list(pluginId: string, prefix?: string): Promise<string[]>;
}

/** In-memory storage, useful for tests and transient embeds. */
export class MemoryStorage implements PluginStorage {
  private readonly byPlugin = new Map<string, Map<string, unknown>>();

  get(pluginId: string, key: string): Promise<unknown> {
    const map = this.byPlugin.get(pluginId);
    return Promise.resolve(map ? map.get(key) ?? null : null);
  }
  put(pluginId: string, key: string, value: unknown): Promise<void> {
    let map = this.byPlugin.get(pluginId);
    if (!map) {
      map = new Map();
      this.byPlugin.set(pluginId, map);
    }
    map.set(key, value);
    return Promise.resolve();
  }
  del(pluginId: string, key: string): Promise<void> {
    const map = this.byPlugin.get(pluginId);
    map?.delete(key);
    return Promise.resolve();
  }
  list(pluginId: string, prefix = ""): Promise<string[]> {
    const map = this.byPlugin.get(pluginId);
    if (!map) return Promise.resolve([]);
    return Promise.resolve(
      Array.from(map.keys()).filter((k) => k.startsWith(prefix)),
    );
  }
}

/** localStorage-backed storage for browser hosts. */
export class LocalStorageBackedStorage implements PluginStorage {
  constructor(private readonly ns = "pluginforge:") {}

  private k(pluginId: string, key: string): string {
    return `${this.ns}${pluginId}:${key}`;
  }

  async get(pluginId: string, key: string): Promise<unknown> {
    const raw = localStorage.getItem(this.k(pluginId, key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  async put(pluginId: string, key: string, value: unknown): Promise<void> {
    localStorage.setItem(this.k(pluginId, key), JSON.stringify(value));
  }
  async del(pluginId: string, key: string): Promise<void> {
    localStorage.removeItem(this.k(pluginId, key));
  }
  async list(pluginId: string, prefix = ""): Promise<string[]> {
    const out: string[] = [];
    const full = `${this.ns}${pluginId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) {
        const tail = k.slice(full.length);
        if (tail.startsWith(prefix)) out.push(tail);
      }
    }
    return out;
  }
}

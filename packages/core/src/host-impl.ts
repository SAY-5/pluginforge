// Default implementation of host-exposed RPC methods. The host runtime
// authorizes calls via CapabilityRouter and then dispatches here.

import type { PluginStorage } from "./storage.js";

export interface HostCallbacks {
  notify(pluginId: string, message: string, level: "info" | "warn" | "error"): void;
  addCommand(pluginId: string, commandId: string, title: string): void;
  registerPanel(pluginId: string, panelId: string, title: string): void;
  clipboardRead?(): Promise<string>;
  clipboardWrite?(text: string): Promise<void>;
  getEnv?(key: string): string | null;
  runShell?(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
}

export class HostImpl {
  constructor(
    private readonly storage: PluginStorage,
    private readonly callbacks: HostCallbacks,
  ) {}

  async dispatch(pluginId: string, method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "ui.notify": {
        const message = String(args[0] ?? "");
        const opts = (args[1] as { level?: "info" | "warn" | "error" } | undefined) ?? {};
        this.callbacks.notify(pluginId, message, opts.level ?? "info");
        return;
      }
      case "ui.addCommand": {
        this.callbacks.addCommand(pluginId, String(args[0]), String(args[1]));
        return;
      }
      case "commands.register":
        // Alias for ui.addCommand with a handler name; commands can be invoked
        // by the host by sending a matching RPC req back into the plugin.
        this.callbacks.addCommand(pluginId, String(args[0]), String(args[0]));
        return;
      case "ui.registerPanel": {
        this.callbacks.registerPanel(pluginId, String(args[0]), String(args[1]));
        return;
      }
      case "storage.get":
        return this.storage.get(pluginId, String(args[0]));
      case "storage.put":
        return this.storage.put(pluginId, String(args[0]), args[1]);
      case "storage.del":
        return this.storage.del(pluginId, String(args[0]));
      case "storage.list":
        return this.storage.list(pluginId, args[0] as string | undefined);
      case "net.fetch": {
        const url = String(args[0]);
        const init = (args[1] as RequestInit & { body?: string }) ?? {};
        const resp = await fetch(url, init);
        const headers: Record<string, string> = {};
        resp.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const body = await resp.text();
        return { status: resp.status, headers, body };
      }
      case "clipboard.read":
        if (!this.callbacks.clipboardRead) throw new Error("clipboard.read not supported");
        return this.callbacks.clipboardRead();
      case "clipboard.write":
        if (!this.callbacks.clipboardWrite) throw new Error("clipboard.write not supported");
        return this.callbacks.clipboardWrite(String(args[0]));
      case "env.get":
        return this.callbacks.getEnv ? this.callbacks.getEnv(String(args[0])) : null;
      case "shell.run":
        if (!this.callbacks.runShell) throw new Error("shell.run not supported");
        return this.callbacks.runShell(String(args[0]), args[1] as string[]);
      default:
        throw new Error(`host: unknown method ${method}`);
    }
  }
}

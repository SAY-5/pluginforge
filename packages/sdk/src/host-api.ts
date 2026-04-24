// The typed surface that plugins import to call the host. Every method maps
// to an RPC method name; the host enforces capabilities before dispatch.

export interface HostApi {
  ui: {
    notify(message: string, opts?: { level?: "info" | "warn" | "error" }): Promise<void>;
    addCommand(id: string, title: string): Promise<void>;
    registerPanel(id: string, title: string): Promise<void>;
  };
  commands: {
    register(id: string, handlerName: string): Promise<void>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    del(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
  };
  net: {
    fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }>;
  };
  clipboard: {
    read(): Promise<string>;
    write(text: string): Promise<void>;
  };
  env: {
    get(key: string): Promise<string | null>;
  };
  shell: {
    run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
  };
  events: {
    emit(topic: string, data: unknown): Promise<void>;
    on(topic: string, handler: (data: unknown) => void): () => void;
  };
}

export interface PluginLifecycle {
  onActivate?(): Promise<void> | void;
  onDeactivate?(): Promise<void> | void;
}

export type PluginHandler = (...args: unknown[]) => unknown | Promise<unknown>;

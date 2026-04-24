import { useEffect, useMemo, useRef, useState } from "react";
import {
  Host,
  LocalStorageBackedStorage,
  type LoadedPlugin,
} from "@pluginforge/core";
import {
  humanizeCapability,
  type Capability,
  type PluginManifest,
} from "@pluginforge/sdk";
import { DEMO_PLUGINS, type DemoPluginDef } from "./demo-plugins.js";

interface LogLine {
  id: number;
  pluginId: string;
  level: "info" | "warn" | "error";
  message: string;
  t: number;
}

export function App() {
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [commands, setCommands] = useState<
    Array<{ pluginId: string; id: string; title: string }>
  >([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteCursor, setPaletteCursor] = useState(0);
  const logCounter = useRef(0);

  const host = useMemo(() => {
    return new Host({
      storage: new LocalStorageBackedStorage("pluginforge:"),
      callbacks: {
        notify: (pluginId, message, level) => {
          logCounter.current += 1;
          setLogs((xs) => [
            ...xs.slice(-999),
            {
              id: logCounter.current,
              pluginId,
              level: level as LogLine["level"],
              message,
              t: Date.now(),
            },
          ]);
        },
        addCommand: (pluginId, id, title) => {
          setCommands((xs) =>
            xs.some((c) => c.pluginId === pluginId && c.id === id)
              ? xs
              : [...xs, { pluginId, id, title }],
          );
        },
        registerPanel: () => {},
      },
    });
  }, []);

  const refresh = () => setPlugins([...host.loaded]);

  useEffect(() => {
    // Load all demo plugins on boot.
    (async () => {
      for (const def of DEMO_PLUGINS) {
        try {
          await host.load({ manifest: def.manifest, bundle: def.bundle });
        } catch (err) {
          console.error("failed to load plugin", def.manifest.id, err);
        }
      }
      refresh();
      setSelected(DEMO_PLUGINS[0]?.manifest.id ?? null);
    })();

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((x) => !x);
        setPaletteQuery("");
        setPaletteCursor(0);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPlugin = plugins.find((p) => p.id === selected);

  const filteredCommands = commands.filter((c) =>
    (c.title + " " + c.id).toLowerCase().includes(paletteQuery.toLowerCase()),
  );

  const invokeCommand = async (pluginId: string, commandId: string) => {
    const p = host.get(pluginId);
    if (!p) return;
    try {
      const res = await p.invoke(commandId, []);
      host["opts"].callbacks.notify(pluginId, `command ${commandId} → ${JSON.stringify(res)}`, "info");
    } catch (err) {
      host["opts"].callbacks.notify(pluginId, `command ${commandId} failed: ${String(err)}`, "error");
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-brand-logo">⬢</span>
          <span>plugin</span>
          <span className="slash">/</span>
          <span>forge</span>
          <span className="tag">· runtime</span>
        </div>
        <div className="topbar-meta">
          <span>plugins<b>{plugins.length}</b></span>
          <span>commands<b>{commands.length}</b></span>
          <span>
            palette <kbd>⌘K</kbd>
          </span>
        </div>
      </header>

      <aside className="sidebar">
        <h2>
          <span>Installed</span>
          <span style={{ color: "var(--fg-muted)", fontWeight: 400, fontSize: 9.5 }}>
            {plugins.length}/3
          </span>
        </h2>
        <ul className="plugin-list">
          {plugins.map((p) => (
            <li
              key={p.id}
              className={p.id === selected ? "active" : ""}
              onClick={() => setSelected(p.id)}
            >
              <div className="name">{p.manifest.name}</div>
              <div className="version">
                {p.manifest.id} · v{p.manifest.version}
              </div>
            </li>
          ))}
          {plugins.length === 0 && (
            <li style={{ color: "var(--fg-muted)", fontStyle: "italic" }}>
              boot sequence…
            </li>
          )}
        </ul>
      </aside>

      <main className="main">
        {selectedPlugin ? (
          <PluginDetail
            plugin={selectedPlugin}
            commands={commands.filter((c) => c.pluginId === selectedPlugin.id)}
            onInvoke={(id) => invokeCommand(selectedPlugin.id, id)}
          />
        ) : (
          <div className="card">
            <div className="card-eyebrow">Ready</div>
            <h3>Select a plugin from the left rail</h3>
            <p>
              Press <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> to open the command
              palette — commands are aggregated across every loaded plugin.
              Plugin runtime boots each into a hardened Web Worker; the
              right panel streams their output.
            </p>
          </div>
        )}
      </main>

      <aside className="console">
        <h2>
          <span>Runtime log</span>
          <span style={{ color: "var(--fg-muted)", fontWeight: 400, fontSize: 9.5 }}>
            {logs.length}
          </span>
        </h2>
        <div className="console-log">
          {logs.slice(-300).map((l) => (
            <div key={l.id} className={`line ${l.level}`}>
              <span className="plugin-id">
                [{new Date(l.t).toLocaleTimeString()} {l.pluginId}]
              </span>{" "}
              {l.message}
            </div>
          ))}
        </div>
      </aside>

      {paletteOpen && (
        <div className="command-palette" onClick={() => setPaletteOpen(false)}>
          <div
            className="command-palette-inner"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={paletteQuery}
              placeholder="▸ search commands across all plugins…"
              onChange={(e) => {
                setPaletteQuery(e.target.value);
                setPaletteCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPaletteCursor((c) =>
                    Math.min(c + 1, filteredCommands.length - 1),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPaletteCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter") {
                  const cmd = filteredCommands[paletteCursor];
                  if (cmd) {
                    setPaletteOpen(false);
                    void invokeCommand(cmd.pluginId, cmd.id);
                  }
                }
              }}
            />
            <ul className="command-palette-list">
              {filteredCommands.map((c, i) => (
                <li
                  key={`${c.pluginId}:${c.id}`}
                  className={i === paletteCursor ? "active" : ""}
                  onMouseEnter={() => setPaletteCursor(i)}
                  onClick={() => {
                    setPaletteOpen(false);
                    void invokeCommand(c.pluginId, c.id);
                  }}
                >
                  <span>{c.title}</span>
                  <span className="meta">
                    {c.pluginId.split(".").pop()} · {c.id}
                  </span>
                </li>
              ))}
              {filteredCommands.length === 0 && (
                <li style={{ color: "var(--fg-muted)", fontStyle: "italic" }}>
                  no matches
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function PluginDetail({
  plugin,
  commands,
  onInvoke,
}: {
  plugin: LoadedPlugin;
  commands: Array<{ id: string; title: string }>;
  onInvoke: (id: string) => void;
}) {
  const m: PluginManifest = plugin.manifest;
  return (
    <>
      <div className="card">
        <div className="card-eyebrow">{plugin.status}</div>
        <h3>
          {m.name}
          <span className="version">v{m.version}</span>
        </h3>
        {m.description && <p>{m.description}</p>}
        <div className="status-row">
          <span>id <b>{m.id}</b></span>
          <span>caps <b>{m.capabilities.length}</b></span>
          <span>commands <b>{commands.length}</b></span>
        </div>
      </div>
      <div className="card">
        <div className="card-eyebrow">Capabilities</div>
        <h3>Granted surface</h3>
        <p style={{ marginBottom: 16 }}>
          Every RPC from this plugin is validated against these grants at
          the boundary. Nothing else is reachable.
        </p>
        <ul className="caps">
          {m.capabilities.map((c, i) => (
            <li key={i}>
              <span>{humanizeCapability(c as Capability)}</span>
              <span className="badge ok">granted</span>
            </li>
          ))}
          {m.capabilities.length === 0 && (
            <li style={{ color: "var(--fg-muted)", fontStyle: "italic" }}>
              no capabilities requested
            </li>
          )}
        </ul>
      </div>
      <div className="card">
        <div className="card-eyebrow">Commands</div>
        <h3>Registered actions</h3>
        {commands.length === 0 ? (
          <p style={{ color: "var(--fg-muted)", fontStyle: "italic" }}>
            no commands registered yet — plugin may still be activating
          </p>
        ) : (
          <ul className="caps">
            {commands.map((c) => (
              <li key={c.id}>
                <span>
                  {c.title}{" "}
                  <span
                    style={{
                      color: "var(--fg-muted)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      marginLeft: 6,
                    }}
                  >
                    · {c.id}
                  </span>
                </span>
                <button onClick={() => onInvoke(c.id)}>▶ run</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

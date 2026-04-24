import { plugin } from "@pluginforge/sdk";

interface Todo {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
}

function newId(): string {
  return "t_" + Math.random().toString(36).slice(2, 10);
}

plugin.onActivate(async () => {
  await plugin.host.ui.addCommand("todo.add", "Todo → Add");
  await plugin.host.ui.addCommand("todo.list", "Todo → List");
  await plugin.host.ui.addCommand("todo.toggle", "Todo → Toggle done");

  plugin.registerHandler("todo.add", async (title: unknown) => {
    if (typeof title !== "string" || title.length === 0) {
      throw new Error("title required");
    }
    const t: Todo = { id: newId(), title, done: false, createdAt: Date.now() };
    await plugin.host.storage.put(`todo:${t.id}`, t);
    await plugin.host.events.emit("todo.changed", { id: t.id, action: "added" });
    return t;
  });

  plugin.registerHandler("todo.list", async () => {
    const ids = await plugin.host.storage.list("todo:");
    const out: Todo[] = [];
    for (const key of ids) {
      const t = (await plugin.host.storage.get<Todo>(key)) as Todo | null;
      if (t) out.push(t);
    }
    out.sort((a, b) => a.createdAt - b.createdAt);
    return out;
  });

  plugin.registerHandler("todo.toggle", async (id: unknown) => {
    if (typeof id !== "string") throw new Error("id required");
    const t = (await plugin.host.storage.get<Todo>(`todo:${id}`)) as Todo | null;
    if (!t) throw new Error("not found");
    t.done = !t.done;
    await plugin.host.storage.put(`todo:${id}`, t);
    await plugin.host.events.emit("todo.changed", { id, action: "toggled" });
    return t;
  });

  plugin.registerHandler("todo.worldTime", async () => {
    const r = await plugin.host.net.fetch("https://worldtimeapi.org/api/ip");
    return r.status === 200 ? JSON.parse(r.body) : { error: r.status };
  });
});

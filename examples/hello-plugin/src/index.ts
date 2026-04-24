import { plugin } from "@pluginforge/sdk";

plugin.onActivate(async () => {
  await plugin.host.ui.addCommand("hello.sayHi", "Say Hi");
  plugin.registerHandler("hello.sayHi", async () => {
    await plugin.host.ui.notify("Hello from the Hello plugin!");
    return { ok: true };
  });
});

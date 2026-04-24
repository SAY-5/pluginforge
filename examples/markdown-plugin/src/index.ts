import { plugin } from "@pluginforge/sdk";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal markdown: headings, bold, italic, inline code, links, paragraphs.
function render(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let para: string[] = [];
  function flushPara() {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  }
  function inline(s: string): string {
    let h = escapeHtml(s);
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    h = h.replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      (_m, text, url) => `<a href="${url}">${text}</a>`,
    );
    return h;
  }
  for (const raw of lines) {
    const line = raw ?? "";
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = (h[1] as string).length;
      out.push(`<h${level}>${inline(h[2] as string)}</h${level}>`);
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return out.join("\n");
}

plugin.onActivate(async () => {
  await plugin.host.ui.addCommand("md.render", "Markdown → Render");
  await plugin.host.ui.addCommand("md.save", "Markdown → Save snippet");
  plugin.registerHandler("md.render", async (md: unknown) => {
    if (typeof md !== "string") throw new Error("md must be string");
    return render(md);
  });
  plugin.registerHandler("md.save", async (name: unknown, md: unknown) => {
    if (typeof name !== "string" || typeof md !== "string") {
      throw new Error("name and md must be strings");
    }
    await plugin.host.storage.put(`snippet:${name}`, { md, savedAt: Date.now() });
    await plugin.host.ui.notify(`Saved "${name}"`);
  });
  plugin.registerHandler("md.list", async () => {
    return plugin.host.storage.list("snippet:");
  });
});

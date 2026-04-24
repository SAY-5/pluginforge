import { test, expect } from "@playwright/test";

/**
 * End-to-end against the real host-app: the demo plugins are bundled in
 * via Vite ?raw imports, spawn into real Web Workers at page load, and
 * register commands through the RPC layer. These tests verify the whole
 * chain works in a real browser (not just our fake-worker unit tests).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Wait for the plugin list to populate.
  await page.locator(".plugin-list li").first().waitFor({ timeout: 10_000 });
});

test("all three demo plugins load and reach ready", async ({ page }) => {
  // Plugin list should show hello, markdown, todo.
  const items = page.locator(".plugin-list li .name");
  await expect(items).toHaveCount(3);
  const texts = await items.allTextContents();
  expect(texts.sort()).toEqual(["Hello Plugin", "Markdown Renderer", "Todo"]);
});

test("Hello plugin exposes its command; invoking it logs to console", async ({ page }) => {
  // Select hello plugin.
  await page.locator(".plugin-list li").filter({ hasText: "Hello Plugin" }).click();
  // Its registered command "Say Hi" should show up in the commands list.
  const cmd = page.locator(".card").filter({ hasText: "Commands" }).getByRole("button", { name: "Run" });
  await cmd.first().click();
  // Console should pick up the notify(...) call.
  await expect(page.locator(".console-log .line").filter({ hasText: "Hello from the Hello plugin" })).toBeVisible({
    timeout: 5_000,
  });
});

test("command palette (⌘K) lists plugin commands across plugins", async ({ page }) => {
  // Open palette.
  const isMac = process.platform === "darwin";
  await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
  await page.locator(".command-palette-inner input").waitFor();
  // Should list commands from multiple plugins. We filter to "Todo" and
  // expect at least one match (todo.add / todo.list / todo.toggle).
  await page.locator(".command-palette-inner input").fill("Todo");
  const items = page.locator(".command-palette-list li");
  await expect(items).not.toHaveCount(0);
  const titles = await items.allTextContents();
  expect(titles.some((t) => /Todo/.test(t))).toBe(true);
  // Close palette.
  await page.keyboard.press("Escape");
});

test("capabilities panel shows granted caps for a plugin", async ({ page }) => {
  await page.locator(".plugin-list li").filter({ hasText: "Todo" }).click();
  const capsCard = page.locator(".card").filter({ hasText: "Capabilities" });
  await expect(capsCard).toContainText("Store data privately for this plugin");
  await expect(capsCard).toContainText("Show toast notifications");
});

import { describe, expect, it } from "vitest";
import { matchUrlPattern } from "@pluginforge/sdk";

describe("matchUrlPattern", () => {
  it("exact match", () => {
    expect(matchUrlPattern("https://a.example/b", "https://a.example/b")).toBe(true);
    expect(matchUrlPattern("https://a.example/b", "https://a.example/c")).toBe(false);
  });

  it("wildcard path", () => {
    expect(matchUrlPattern("https://a.example/*", "https://a.example/anything")).toBe(true);
    expect(matchUrlPattern("https://a.example/v1/*", "https://a.example/v1/x")).toBe(true);
    expect(matchUrlPattern("https://a.example/v1/*", "https://a.example/v2/x")).toBe(false);
  });

  it("scheme must match", () => {
    expect(matchUrlPattern("https://a.example/*", "http://a.example/foo")).toBe(false);
  });

  it("host must match exactly (no host wildcards)", () => {
    expect(matchUrlPattern("https://*.example/*", "https://any.example/foo")).toBe(false);
  });

  it("port is part of host comparison", () => {
    expect(matchUrlPattern("https://a.example:8080/*", "https://a.example:8080/x")).toBe(true);
    expect(matchUrlPattern("https://a.example:8080/*", "https://a.example/x")).toBe(false);
  });

  it("rejects `..` traversal segments in the requested URL", () => {
    expect(
      matchUrlPattern("https://a.example/public/*", "https://a.example/public/../private/x"),
    ).toBe(false);
  });

  it("is not fooled by a look-alike host", () => {
    expect(
      matchUrlPattern("https://api.example.com/*", "https://api.example.com.attacker.com/foo"),
    ).toBe(false);
  });

  it("rejects malformed URLs/patterns", () => {
    expect(matchUrlPattern("not-a-url", "https://a.example")).toBe(false);
    expect(matchUrlPattern("https://a.example/*", "also-not-a-url")).toBe(false);
  });
});

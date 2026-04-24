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
});

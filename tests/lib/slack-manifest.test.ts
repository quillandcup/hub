import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const manifest = parseYaml(readFileSync("slack-app-manifest.yml", "utf8")) as Record<string, any>;

describe("slack-app-manifest.yml", () => {
  it("grants the incoming-webhook bot scope for the #hub-alerts audit webhook", () => {
    expect(manifest.oauth_config.scopes.bot).toContain("incoming-webhook");
    expect(manifest.oauth_config.scopes.user ?? []).not.toContain("incoming-webhook");
  });

  it("keeps the scopes Billie Bot already relies on", () => {
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining(["chat:write", "commands", "channels:manage"]),
    );
  });
});

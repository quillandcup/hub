import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

const outboundFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/outbound", () => ({ outboundFetch }));
const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

import { APPS, flatten, main, parseArgs, printDiff } from "../../scripts/slack-manifest";

function slackReply(body: Record<string, unknown>) {
  return { ok: true, json: async () => body };
}

/** Which Slack methods were called, in order. */
function methods(): string[] {
  return outboundFetch.mock.calls.map((c) => String(c[0]).replace("https://slack.com/api/", ""));
}

function bodyOf(call: number): URLSearchParams {
  return outboundFetch.mock.calls[call][1].body as URLSearchParams;
}

class Exit extends Error {}

beforeEach(() => {
  outboundFetch.mockReset();
  spawnSync.mockReset();
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Exit();
  }) as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SLACK_CONFIG_TOKEN", "xoxe.xoxp-test");
  vi.stubEnv("SLACK_APP_ID", "A111");
  vi.stubEnv("SLACK_ALERTS_APP_ID", "A222");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("defaults to Billie Bot, so the original CLI is unchanged", () => {
    expect(parseArgs(["diff"])).toEqual({ mode: "diff", apps: ["billie"] });
    expect(parseArgs(["push"])).toEqual({ mode: "push", apps: ["billie"] });
  });

  it("takes one app or a comma-separated list, without duplicates", () => {
    expect(parseArgs(["push", "alerts"]).apps).toEqual(["alerts"]);
    expect(parseArgs(["push", "billie,alerts,billie"]).apps).toEqual(["billie", "alerts"]);
  });

  it("rejects an unknown mode or app", () => {
    expect(() => parseArgs([])).toThrow(Exit);
    expect(() => parseArgs(["nuke"])).toThrow(Exit);
    expect(() => parseArgs(["push", "other"])).toThrow(Exit);
  });

  it("allows create only for the alerts app", () => {
    expect(parseArgs(["create", "alerts"])).toEqual({ mode: "create", apps: ["alerts"] });
    expect(() => parseArgs(["create"])).toThrow(Exit);
    expect(() => parseArgs(["create", "billie"])).toThrow(Exit);
    expect(() => parseArgs(["create", "billie,alerts"])).toThrow(Exit);
  });
});

describe("flatten and printDiff", () => {
  it("compares scalar lists as sets", () => {
    expect([...flatten({ a: ["y", "x"] }, "", new Map())]).toEqual([["a", '["x","y"]']]);
  });

  it("reports additions, removals and changes, and none when equal", () => {
    expect(printDiff({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(0);
    expect(printDiff({ a: 1, b: 2 }, { a: 3, c: 4 })).toBe(3);
  });
});

describe("main", () => {
  it("diffs Billie Bot by default and never writes", async () => {
    outboundFetch.mockResolvedValue(slackReply({ ok: true, manifest: { display_information: { name: "x" } } }));
    await main(["diff"]);
    expect(methods()).toEqual(["apps.manifest.export"]);
    expect(bodyOf(0).get("app_id")).toBe("A111");
  });

  it("pushes the alerts manifest to the alerts app id when it differs", async () => {
    outboundFetch
      .mockResolvedValueOnce(slackReply({ ok: true, manifest: { display_information: { name: "old" } } }))
      .mockResolvedValueOnce(slackReply({ ok: true }));
    await main(["push", "alerts"]);
    expect(methods()).toEqual(["apps.manifest.export", "apps.manifest.update"]);
    expect(bodyOf(1).get("app_id")).toBe("A222");
    const sent = JSON.parse(bodyOf(1).get("manifest")!);
    expect(sent.display_information.name).toBe("Hub alerts webhook");
  });

  it("skips the update when the live app already matches", async () => {
    const local = parseYaml(readFileSync(APPS.alerts.manifestFile, "utf8"));
    outboundFetch.mockResolvedValue(slackReply({ ok: true, manifest: local }));
    await main(["push", "alerts"]);
    expect(methods()).toEqual(["apps.manifest.export"]);
  });

  it("warns when scopes changed so the app gets reinstalled", async () => {
    outboundFetch
      .mockResolvedValueOnce(slackReply({ ok: true, manifest: {} }))
      .mockResolvedValueOnce(slackReply({ ok: true, permissions_updated: true }));
    await main(["push", "alerts"]);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("::warning::");
  });

  it("pushes both apps with a single token rotation", async () => {
    vi.stubEnv("SLACK_CONFIG_TOKEN", "");
    vi.stubEnv("SLACK_CONFIG_REFRESH_TOKEN", "xoxe-refresh");
    vi.stubEnv("GITHUB_REPOSITORY", "owner/repo");
    vi.stubEnv("GH_TOKEN", "ghp-test");
    spawnSync.mockReturnValue({ status: 0 });
    outboundFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("tooling.tokens.rotate")) {
        return slackReply({ ok: true, token: "xoxe.xoxp-new", refresh_token: "xoxe-new" });
      }
      return slackReply({ ok: true, manifest: {} });
    });
    await main(["push", "billie,alerts"]);
    expect(methods().filter((m) => m === "tooling.tokens.rotate")).toHaveLength(1);
    expect(methods().filter((m) => m === "apps.manifest.update")).toHaveLength(2);
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("checks every app id before rotating, so a missing one spends nothing", async () => {
    vi.stubEnv("SLACK_CONFIG_TOKEN", "");
    vi.stubEnv("SLACK_ALERTS_APP_ID", "");
    await expect(main(["push", "billie,alerts"])).rejects.toBeInstanceOf(Exit);
    expect(outboundFetch).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("creates the alerts app from its manifest and prints only the app id", async () => {
    outboundFetch.mockResolvedValue(
      slackReply({
        ok: true,
        app_id: "A0NEWAPP",
        credentials: { client_secret: "SECRET-CLIENT", signing_secret: "SECRET-SIGNING", verification_token: "SECRET-V" },
      }),
    );
    await main(["create", "alerts"]);
    expect(methods()).toEqual(["apps.manifest.create"]);
    expect(JSON.parse(bodyOf(0).get("manifest")!).oauth_config.scopes.bot).toEqual(["incoming-webhook"]);
    const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(printed).toContain("A0NEWAPP");
    expect(printed).not.toContain("SECRET");
    expect(printed).not.toContain("xoxe");
  });

  it("needs a local access token and never rotates the CI refresh token", async () => {
    vi.stubEnv("SLACK_CONFIG_TOKEN", "");
    vi.stubEnv("SLACK_CONFIG_REFRESH_TOKEN", "xoxe-refresh");
    await expect(main(["create", "alerts"])).rejects.toBeInstanceOf(Exit);
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it("fails with Slack's error when creation is rejected", async () => {
    outboundFetch.mockResolvedValue(slackReply({ ok: false, error: "invalid_manifest" }));
    await expect(main(["create", "alerts"])).rejects.toBeInstanceOf(Exit);
  });
});

describe("the alerts manifest", () => {
  const manifest = parseYaml(readFileSync(APPS.alerts.manifestFile, "utf8")) as Record<string, any>;

  it("can only post through an incoming webhook", () => {
    expect(manifest.oauth_config.scopes.bot).toEqual(["incoming-webhook"]);
    expect(manifest.oauth_config.scopes.user).toBeUndefined();
  });

  it("subscribes to nothing and exposes no URLs or commands", () => {
    expect(manifest.settings.event_subscriptions).toBeUndefined();
    expect(manifest.settings.interactivity).toBeUndefined();
    expect(manifest.features.slash_commands).toBeUndefined();
    expect(manifest.oauth_config.redirect_urls).toBeUndefined();
    expect(readFileSync(APPS.alerts.manifestFile, "utf8")).not.toMatch(/https?:\/\//);
  });

  it("keeps socket mode and token rotation off", () => {
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.settings.token_rotation_enabled).toBe(false);
  });
});

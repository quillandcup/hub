import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import appConfig from "@/app.config";
import {
  describeAddress,
  devWebhookAddress,
  envValue,
  normalizeAddress,
  sameAddress,
  parseMuxConfig,
  planRestriction,
  planWebhook,
  restrictionBody,
  setEnvValue,
  unmanagedWebhooks,
  webhookAddress,
  type LiveRestriction,
  type LiveWebhook,
} from "@/lib/mux-config";

const host = "hub.example.com";
const valid = {
  webhook: { path: "/api/webhooks/mux" },
  playbackRestriction: { allowedDomains: ["{appHost}", "*.vercel.app"], allowNoReferrer: true },
};
const hook = (address: string, enabled = true, id = "w1"): LiveWebhook => ({ id, address, enabled });
const restriction = (domains: string[], noRef = true, id = "r1"): LiveRestriction => ({
  id,
  referrer: { allowed_domains: domains, allow_no_referrer: noRef },
});

describe("mux-config.yml", () => {
  it("parses the committed file against the real app host", () => {
    const parsed = parseMuxConfig(
      parseYaml(readFileSync("mux-config.yml", "utf8")),
      new URL(appConfig.appUrl).host,
    );
    expect(parsed.webhookPath).toBe("/api/webhooks/mux");
    expect(parsed.restriction.allowedDomains).toContain(new URL(appConfig.appUrl).host);
    expect(webhookAddress(appConfig.appUrl, parsed.webhookPath)).toBe(`${appConfig.appUrl}/api/webhooks/mux`);
  });
});

describe("parseMuxConfig", () => {
  it("expands {appHost} and removes duplicates", () => {
    const cfg = parseMuxConfig(
      { ...valid, playbackRestriction: { allowedDomains: ["{appHost}", host, "a.com"], allowNoReferrer: false } },
      host,
    );
    expect(cfg.restriction).toEqual({ allowedDomains: [host, "a.com"], allowNoReferrer: false });
  });

  it.each([
    ["no webhook path", { ...valid, webhook: {} }],
    ["relative path", { ...valid, webhook: { path: "api/x" } }],
    ["domains not a list", { ...valid, playbackRestriction: { allowedDomains: "a.com", allowNoReferrer: true } }],
    ["blank domain", { ...valid, playbackRestriction: { allowedDomains: [" "], allowNoReferrer: true } }],
    ["no allowNoReferrer", { ...valid, playbackRestriction: { allowedDomains: ["a.com"] } }],
    [
      "more than 10 domains",
      { ...valid, playbackRestriction: { allowedDomains: Array.from({ length: 11 }, (_, i) => `d${i}.com`), allowNoReferrer: true } },
    ],
    ["* mixed with others", { ...valid, playbackRestriction: { allowedDomains: ["*", "a.com"], allowNoReferrer: true } }],
    ["empty file", null],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseMuxConfig(raw, host)).toThrow(/mux-config\.yml/);
  });
});

describe("addresses", () => {
  it("joins the app URL and path without doubling slashes", () => {
    expect(webhookAddress("https://x.test/", "/api/webhooks/mux")).toBe("https://x.test/api/webhooks/mux");
  });
  it("builds a developer address from a bare tunnel hostname and rejects anything else", () => {
    expect(devWebhookAddress("me.ngrok-free.dev", "/api/webhooks/mux")).toBe("https://me.ngrok-free.dev/api/webhooks/mux");
    expect(() => devWebhookAddress("https://me.ngrok-free.dev", "/p")).toThrow(/bare hostname/);
  });
});

describe("planWebhook", () => {
  const want = "https://x.test/api/webhooks/mux";
  it("is ok when an enabled webhook has the address", () => {
    expect(planWebhook(want, [hook(want)])).toEqual({ kind: "ok", id: "w1" });
  });
  it("enables a disabled one", () => {
    expect(planWebhook(want, [hook(want, false)])).toEqual({ kind: "enable", id: "w1", address: want });
  });
  it("creates when none matches, and never adopts another webhook by default", () => {
    expect(planWebhook(want, [hook("https://other.test/x")])).toEqual({ kind: "create", address: want });
    expect(planWebhook(want, [])).toEqual({ kind: "create", address: want });
  });
  it("with adoptSingle moves the only webhook, but creates when there are several", () => {
    expect(planWebhook(want, [hook("https://old.test/x")], { adoptSingle: true })).toEqual({
      kind: "update-address",
      id: "w1",
      from: "https://old.test/x",
      to: want,
    });
    expect(planWebhook(want, [hook("https://a.test"), hook("https://b.test", true, "w2")], { adoptSingle: true }).kind).toBe("create");
  });
  it("lists webhooks it does not manage", () => {
    expect(unmanagedWebhooks(want, [hook(want), hook("https://other.test", true, "w2")]).map((w) => w.id)).toEqual(["w2"]);
  });
});

describe("planRestriction", () => {
  const want = { allowedDomains: ["a.com", "b.com"], allowNoReferrer: true };
  it("creates when none exists", () => {
    expect(planRestriction(want, [])).toEqual({ kind: "create" });
  });
  it("is ok when equal, whatever the order", () => {
    expect(planRestriction(want, [restriction(["b.com", "a.com"])])).toEqual({ kind: "ok", id: "r1" });
  });
  it("updates when domains or the no-referrer flag differ", () => {
    expect(planRestriction(want, [restriction(["a.com"])])).toEqual({ kind: "update", id: "r1" });
    expect(planRestriction(want, [restriction(["a.com", "b.com"], false)])).toEqual({ kind: "update", id: "r1" });
  });
  it("refuses to guess among several", () => {
    expect(planRestriction(want, [restriction(["a.com"]), restriction(["b.com"], true, "r2")])).toEqual({ kind: "ambiguous", count: 2 });
  });
  it("sends the API body shape", () => {
    expect(restrictionBody(want)).toEqual({ allowed_domains: ["a.com", "b.com"], allow_no_referrer: true });
  });
});

describe("env file helpers", () => {
  it("replaces an existing line and keeps the others", () => {
    expect(setEnvValue("A=1\nMUX_WEBHOOK_SECRET=old\nB=2\n", "MUX_WEBHOOK_SECRET", "new$&")).toBe("A=1\nMUX_WEBHOOK_SECRET=new$&\nB=2\n");
  });
  it("appends, adding a newline when the file lacks one", () => {
    expect(setEnvValue("A=1", "K", "v")).toBe("A=1\nK=v\n");
    expect(setEnvValue("", "K", "v")).toBe("K=v\n");
  });
  it("reads a value, treating missing, blank and quoted ones", () => {
    expect(envValue("K=\n", "K")).toBe("");
    expect(envValue("A=1\n", "K")).toBe("");
    expect(envValue('K="abc"\n', "K")).toBe("abc");
  });
});

describe("webhook addresses", () => {
  const want = "https://x.test/api/webhooks/mux";

  it("treats a trailing slash, host case and a default port as the same place, but not another path, host or query", () => {
    expect(sameAddress(want, "https://x.test/api/webhooks/mux/")).toBe(true);
    expect(sameAddress(want, "https://X.Test/api/webhooks/mux")).toBe(true);
    expect(sameAddress(want, "https://x.test:443/api/webhooks/mux")).toBe(true);
    expect(sameAddress(want, " https://x.test/api/webhooks/mux ")).toBe(true);
    expect(sameAddress(want, "https://x.test/api/webhooks/MUX")).toBe(false);
    expect(sameAddress(want, "https://y.test/api/webhooks/mux")).toBe(false);
    expect(sameAddress(want, "http://x.test/api/webhooks/mux")).toBe(false);
    expect(sameAddress(want, "https://x.test/api/webhooks/mux?a=1")).toBe(false);
    expect(normalizeAddress("not a url ")).toBe("not a url");
  });

  it("finds the existing webhook when it differs only by a trailing slash, instead of planning a second one", () => {
    expect(planWebhook(want, [hook("https://x.test/api/webhooks/mux/")])).toEqual({ kind: "ok", id: "w1" });
    expect(planWebhook(want, [hook("https://X.test/api/webhooks/mux/", false)])).toEqual({ kind: "enable", id: "w1", address: want });
    expect(unmanagedWebhooks(want, [hook("https://x.test/api/webhooks/mux/")])).toEqual([]);
  });

  it("prints an address without credentials or a query, and marks that a query was there", () => {
    expect(describeAddress("https://user:pass@x.test/api/webhooks/mux?token=secret")).toBe("https://x.test/api/webhooks/mux?(query hidden)");
    expect(describeAddress("https://x.test/api/webhooks/mux")).toBe("https://x.test/api/webhooks/mux");
    const printed = describeAddress("https://user:pass@x.test/p?token=secret");
    for (const secret of ["user", "pass", "token", "secret"]) expect(printed).not.toContain(secret);
    expect(describeAddress("nope")).toBe("(not a URL)");
  });

  it("moves the one webhook that exists at another address when adopting (keeping its secret), but still never touches several", () => {
    expect(planWebhook(want, [hook("https://old.test/api/webhooks/mux")], { adoptSingle: true })).toEqual({
      kind: "update-address",
      id: "w1",
      from: "https://old.test/api/webhooks/mux",
      to: want,
    });
    expect(planWebhook(want, [hook("https://a.test/x"), hook("https://b.test/x", true, "w2")], { adoptSingle: true }).kind).toBe("create");
  });
});

import { describe, it, expect } from "vitest";
import {
  attributeMessage,
  attributeText,
  readAttribution,
  stripAttribution,
  withAttribution,
} from "@/lib/notifications/attribution";

const APP = "https://hub.example.test";
const TAG = { kind: "prickle_checkin", channel: "slack" };
const tagged = (path: string, extra = "") => `${APP}${path}?${extra}nk=prickle_checkin&nc=slack`;

describe("withAttribution", () => {
  it("adds the kind and channel to a Hub link, keeping the rest of it", () => {
    expect(withAttribution(`${APP}/prickles/p1`, APP, TAG)).toBe(tagged("/prickles/p1"));
    expect(withAttribution(`${APP}/prickles/p1?tab=notes#m-3`, APP, TAG)).toBe(`${APP}/prickles/p1?tab=notes&nk=prickle_checkin&nc=slack#m-3`);
  });

  it.each([
    ["another site", "https://elsewhere.test/prickles/p1"],
    ["an API route", `${APP}/api/email/unsubscribe`],
    ["the unsubscribe page, which carries a signed token", `${APP}/unsubscribe?t=abc`],
    ["notification settings, since opening those isn't opening the notification", `${APP}/settings/notifications`],
    ["something that isn't a URL", `${APP} not a url`],
    ["a lookalike host that starts with the Hub's address", "https://hub.example.test.evil.com/prickles/p1"],
    ["the same host on another port", "https://hub.example.test:8080/prickles/p1"],
    ["a lookalike host with a path-like suffix", "https://hub.example.testing/prickles/p1"],
  ])("leaves %s alone", (_label, url) => {
    expect(withAttribution(url, APP, TAG)).toBe(url);
  });

  it("does not tag a link twice", () => {
    const once = withAttribution(`${APP}/prickles/p1`, APP, TAG);
    expect(withAttribution(once, APP, { kind: "other", channel: "email" })).toBe(once);
  });
});

describe("attributeText", () => {
  it("tags Hub links in plain text and keeps trailing punctuation outside the link", () => {
    expect(attributeText(`Check in here: ${APP}/prickles/p1. Then see ${APP}/streaks, ok?`, APP, TAG)).toBe(
      `Check in here: ${tagged("/prickles/p1")}. Then see ${tagged("/streaks")}, ok?`
    );
  });

  it("tags the link inside Slack's <url|label> without touching the label", () => {
    expect(attributeText(`<${APP}/prickles/p1|Open in the Hub>`, APP, TAG)).toBe(`<${tagged("/prickles/p1")}|Open in the Hub>`);
  });

  it("leaves other links and text alone", () => {
    const text = "See https://elsewhere.test/x and no links at all";
    expect(attributeText(text, APP, TAG)).toBe(text);
  });

  it("works when the Hub address has characters that mean something in a pattern", () => {
    const odd = "https://hub.example.test:8080";
    expect(attributeText(`${odd}/a`, odd, TAG)).toBe(`${odd}/a?nk=prickle_checkin&nc=slack`);
    expect(attributeText("https://hubXexample.test:8080/a", odd, TAG)).toBe("https://hubXexample.test:8080/a");
  });

  it("does not tag lookalike hosts in text", () => {
    const text = `Spoof: https://hub.example.test.evil.com/x and https://hub.example.testing/y`;
    expect(attributeText(text, APP, TAG)).toBe(text);
  });

  it("tags a bare Hub address, with or without a trailing slash", () => {
    expect(attributeText(`Home: ${APP}`, APP, TAG)).toBe(`Home: ${APP}/?nk=prickle_checkin&nc=slack`);
    expect(attributeText(`Home: ${APP}/ ok`, APP, TAG)).toBe(`Home: ${APP}/?nk=prickle_checkin&nc=slack ok`);
  });
});

describe("attributeMessage", () => {
  it("tags the text, the link, the footer links and every Hub link in Slack blocks, however deep", () => {
    const message = {
      text: `Check in: ${APP}/prickles/p1`,
      url: `${APP}/prickles/p1`,
      slackBlocks: [
        { type: "section", text: { type: "mrkdwn", text: `<${APP}/prickles/p1|Open>` } },
        { type: "actions", elements: [{ type: "button", url: `${APP}/streaks`, text: { type: "plain_text", text: "Streaks" } }] },
      ],
      footerLinks: [
        { label: "Notification settings", url: `${APP}/settings/notifications` },
        { label: "Streaks", url: `${APP}/streaks` },
      ],
    };
    const out = attributeMessage(message, APP, TAG);
    expect(out.text).toBe(`Check in: ${tagged("/prickles/p1")}`);
    expect(out.url).toBe(tagged("/prickles/p1"));
    expect(out.slackBlocks).toEqual([
      { type: "section", text: { type: "mrkdwn", text: `<${tagged("/prickles/p1")}|Open>` } },
      { type: "actions", elements: [{ type: "button", url: tagged("/streaks"), text: { type: "plain_text", text: "Streaks" } }] },
    ]);
    expect(out.footerLinks).toEqual([
      { label: "Notification settings", url: `${APP}/settings/notifications` },
      { label: "Streaks", url: tagged("/streaks") },
    ]);
  });

  it("changes nothing on a message without links, and does not change the original", () => {
    const message = { text: "Hello" };
    expect(attributeMessage(message, APP, TAG)).toEqual({ text: "Hello" });
    const withLink = { text: "x", url: `${APP}/a` };
    attributeMessage(withLink, APP, TAG);
    expect(withLink.url).toBe(`${APP}/a`);
  });
});

describe("readAttribution / stripAttribution", () => {
  it("reads a well-formed tag from an address", () => {
    expect(readAttribution("?nk=prickle_checkin&nc=slack")).toEqual({ kind: "prickle_checkin", channel: "slack" });
    expect(readAttribution("?tab=notes&nk=a_b1&nc=push")).toEqual({ kind: "a_b1", channel: "push" });
  });

  it.each(["", "?nk=prickle_checkin", "?nc=slack", "?nk=Bad Kind&nc=slack", "?nk=x&nc=sl ack", `?nk=${"a".repeat(41)}&nc=slack`, "?nk=<script>&nc=slack", "?nk=1abc&nc=slack"])(
    "ignores %j",
    (search) => {
      expect(readAttribution(search)).toBeNull();
    }
  );

  it("removes the tag and keeps everything else", () => {
    expect(stripAttribution("?nk=a&nc=slack")).toBe("");
    expect(stripAttribution("?tab=notes&nk=a&nc=slack&x=1")).toBe("?tab=notes&x=1");
    expect(stripAttribution("?tab=notes")).toBe("?tab=notes");
    expect(stripAttribution("")).toBe("");
  });
});

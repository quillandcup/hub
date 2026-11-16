import { describe, expect, it } from "vitest";
import { hubLinkPath, hubLinksIn, MAX_HUB_LINKS, parseHubLink } from "@/lib/chat/hub-links";
import { hubLinkUnfurls, withHubLinks } from "@/lib/chat/hub-link-cards";
import type { CardUnfurl, Unfurl } from "@/lib/chat/unfurls";

const APP = "https://hub.example.test";
const CHN = "chn_AAAAAAAAAAA1";
const MSG = "msg_AAAAAAAAAAA1";
const PRKL = "prkl_AAAAAAAAAAA1";
const MBR = "mbr_AAAAAAAAAAA1";

describe("parseHubLink", () => {
  it("reads the shapes of the pages that have a card", () => {
    expect(parseHubLink(`${APP}/chat/${CHN}?m=${MSG}`, APP)).toEqual({ kind: "message", channelId: CHN, messageId: MSG });
    expect(parseHubLink(`${APP}/prickles/${PRKL}`, APP)).toEqual({ kind: "prickle", prickleId: PRKL });
    expect(parseHubLink(`${APP}/members/${MBR}/`, APP)).toEqual({ kind: "member", memberId: MBR });
    expect(parseHubLink(`${APP}/prickles/${PRKL}?pleasant=3#x`, APP)).toEqual({ kind: "prickle", prickleId: PRKL });
  });

  it("compares the origin exactly: no other host, look-alike, scheme, port or user info", () => {
    for (const address of [
      `https://hub.example.test.evil.test/prickles/${PRKL}`,
      `https://evilhub.example.test/prickles/${PRKL}`,
      `http://hub.example.test/prickles/${PRKL}`,
      `https://hub.example.test:8443/prickles/${PRKL}`,
      `https://hub.example.test@evil.test/prickles/${PRKL}`,
      `https://user:pw@hub.example.test/prickles/${PRKL}`,
      `https://www.hub.example.test/prickles/${PRKL}`,
    ]) {
      expect(parseHubLink(address, APP), address).toBeNull();
    }
  });

  it("allows http only for a local address, for development", () => {
    expect(parseHubLink(`http://localhost:3000/prickles/${PRKL}`, "http://localhost:3000")).toEqual({ kind: "prickle", prickleId: PRKL });
    expect(parseHubLink(`http://hub.example.test/prickles/${PRKL}`, "http://hub.example.test")).toBeNull();
  });

  it("refuses a path that is not a page with a card, and ids that are not well formed", () => {
    for (const address of [
      `${APP}/chat/${CHN}`,
      `${APP}/chat/${CHN}?m=not-an-id`,
      `${APP}/chat/${MSG}?m=${MSG}`,
      `${APP}/chat/${CHN}/members?m=${MSG}`,
      `${APP}/prickles/${PRKL}/extra`,
      `${APP}/prickles/prkl_0OIl`,
      `${APP}/members/${PRKL}`,
      `${APP}/admin/members/${MBR}`,
      `${APP}/login?next=/prickles/${PRKL}`,
      "not a url",
    ]) {
      expect(parseHubLink(address, APP), address).toBeNull();
    }
  });

  it("rebuilds the path from the ids, never from what was written", () => {
    expect(hubLinkPath({ kind: "message", channelId: CHN, messageId: MSG })).toBe(`/chat/${CHN}?m=${MSG}`);
    expect(hubLinkPath({ kind: "prickle", prickleId: PRKL })).toBe(`/prickles/${PRKL}`);
    expect(hubLinkPath({ kind: "member", memberId: MBR })).toBe(`/members/${MBR}`);
  });
});

describe("hubLinksIn", () => {
  it("finds bare addresses and Slack link tokens in order, once per page, ignoring code and other sites", () => {
    const body = `look <${APP}/prickles/${PRKL}|this> and ${APP}/members/${MBR}. again ${APP}/prickles/${PRKL}/ and https://other.example.test/x \`${APP}/members/mbr_AAAAAAAAAAA2\``;
    expect(hubLinksIn(body, APP).map((l) => l.link.kind)).toEqual(["prickle", "member"]);
  });

  it("keeps the address as written, for the removal mark", () => {
    expect(hubLinksIn(`${APP}/prickles/${PRKL}?utm_source=x`, APP)[0].url).toBe(`${APP}/prickles/${PRKL}?utm_source=x`);
  });

  it("stops at a few links and handles no text", () => {
    const body = Array.from({ length: 6 }, (_, i) => `${APP}/members/mbr_AAAAAAAAAAA${i + 1}`).join(" ");
    expect(hubLinksIn(body, APP)).toHaveLength(MAX_HUB_LINKS);
    expect(hubLinksIn(null, APP)).toEqual([]);
    expect(hubLinksIn("", APP)).toEqual([]);
  });
});

describe("withHubLinks", () => {
  const address = `${APP}/chat/${CHN}?m=${MSG}`;
  const hub = hubLinkUnfurls(address, APP);
  const slackCard = (over: Partial<CardUnfurl>): CardUnfurl => ({
    kind: "card", color: null, authorName: null, authorLink: null, pretext: null, title: "Login | Hedgie Hub", titleLink: null, text: null, fields: [], imageUrl: null, thumbUrl: null, serviceName: null, fromUrl: null, footer: null, ...over,
  });

  it("adds the card, with the key that removes it", () => {
    expect(withHubLinks([], hub, new Set())).toEqual([{ kind: "hub", url: address, link: { kind: "message", channelId: CHN, messageId: MSG }, removeKey: `url:${address}` }]);
  });

  it("drops Slack's card for the same link (the sign-in page) and keeps its other cards", () => {
    const other = slackCard({ title: "Elsewhere", originalUrl: "https://other.example.test/a" });
    const login = slackCard({ originalUrl: address });
    const out = withHubLinks([login, other], hub, new Set());
    expect(out.map((u) => u.kind)).toEqual(["card", "hub"]);
    expect((out[0] as CardUnfurl).title).toBe("Elsewhere");
  });

  it("matches Slack's card on how it wrote the address, not only the exact text", () => {
    const login = slackCard({ fromUrl: `${address}&utm_source=slack` });
    expect(withHubLinks([login], hub, new Set()).map((u) => u.kind)).toEqual(["hub"]);
  });

  it("leaves out a card its author removed, but still drops Slack's", () => {
    const login = slackCard({ originalUrl: address });
    expect(withHubLinks([login], hub, new Set([`url:${address}`]))).toEqual([]);
  });

  it("draws none when the removals could not be read, so a removal is never undone", () => {
    expect(withHubLinks([], hub, null)).toEqual([]);
  });

  it("changes nothing for a message with no Hub link", () => {
    const unfurls: Unfurl[] = [slackCard({ originalUrl: "https://other.example.test/a" })];
    expect(withHubLinks(unfurls, [], new Set())).toBe(unfurls);
  });
});

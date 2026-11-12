import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { hideHubPreviewsRemovedInSlack, removedAttachmentAddresses } from "@/lib/chat/slack-side-unfurl-removal";
import { withLinkPreviews } from "@/lib/chat/link-preview-cards";
import { parseUnfurls } from "@/lib/chat/unfurls";

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

const ONE = "https://example.test/one.jpg";
const TWO = "https://example.test/two";
const TEXT = `see ${ONE} and ${TWO}`;
const card = (url: string, extra: Record<string, unknown> = {}) => ({ id: 1, from_url: url, original_url: url, title: `Title of ${url}`, title_link: url, ...extra });
const supabase = {} as never;

const preview = (messageId: string, url: string, extra: object = {}) =>
  ({ message_id: messageId, position: 0, url, final_url: null, kind: "link", status: "ok", title: `Page ${url}`, description: null, site_name: null, image_url: null, fetched_at: "2026-01-01T00:00:00Z", ...extra }) as never;

/** Bronze holds `before` for each message; chat messages are written in the Hub unless `slack`. */
function seed(rows: { id: string; channel: string; ts: string; before: unknown[]; origin?: "app" | "slack"; previews?: string[]; text?: string }[]) {
  dataset = new InMemoryDataset({
    slackMessages: rows.map((r) => ({ channel_id: r.channel, message_ts: r.ts, user_id: "U1", occurred_at: "2026-01-01T00:00:00Z", raw_payload: { text: r.text ?? TEXT, attachments: r.before } }) as never),
    chatChannels: [...new Set(rows.map((r) => r.channel))].map((c) => ({ id: `chn_${c}`, slack_channel_id: c }) as never),
    chatMessages: rows.map((r) => ({ id: r.id, channel_id: `chn_${r.channel}`, origin: r.origin ?? "app", slack_ts: r.ts, author_member_id: "mbr_AAAAAAAAAAA1", deleted_at: null }) as never),
    chatLinkPreviews: rows.flatMap((r) => (r.previews ?? []).map((u) => preview(r.id, u))),
  });
}
const hiddenOf = async (id: string) => [...((await (await import("@/lib/data/repos")).createRepos(supabase).chatLinkPreviews.hiddenKeys([id])).get(id) ?? [])].sort();
const incoming = (channel: string, ts: string, attachments: unknown[], text = TEXT) => ({ channel_id: channel, message_ts: ts, raw_payload: { text, attachments } });

beforeEach(() => seed([]));

describe("removedAttachmentAddresses", () => {
  it("lists the addresses of attachments that are gone, matching http/https, www and tracking parameters", () => {
    const gone = removedAttachmentAddresses({ text: "x", attachments: [card(ONE), card(TWO)] }, { text: "x", attachments: [card("http://www.example.test/two?utm_source=a")] });
    expect([...gone]).toEqual(["example.test/one.jpg"]);
  });
  it("is empty when nothing was stored, nothing went, or the text changed", () => {
    expect(removedAttachmentAddresses({ text: "x" }, { text: "x", attachments: [card(ONE)] }).size).toBe(0);
    expect(removedAttachmentAddresses({ text: "x", attachments: [card(ONE)] }, { text: "x", attachments: [card(ONE)] }).size).toBe(0);
    expect(removedAttachmentAddresses({ text: "x", attachments: [card(ONE)] }, { text: "y", attachments: [] }).size).toBe(0);
  });
  it("ignores an attachment with no address", () => {
    expect(removedAttachmentAddresses({ text: "x", attachments: [{ text: "an app's card" }] }, { text: "x", attachments: [] }).size).toBe(0);
  });
});

describe("hideHubPreviewsRemovedInSlack", () => {
  it("hides the Hub preview of the link whose Slack attachment is gone, and the loader then draws no card for it", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", channel: "C1", ts: "1.1", before: [card(ONE), card(TWO)], previews: [ONE, TWO] }]);
    expect(await hideHubPreviewsRemovedInSlack(supabase, [incoming("C1", "1.1", [card(TWO)])])).toBe(1);
    expect(await hiddenOf("msg_AAAAAAAAAAD1")).toEqual([`url:${ONE}`]);

    const repos = (await import("@/lib/data/repos")).createRepos(supabase);
    const previews = (await repos.chatLinkPreviews.forMessages(["msg_AAAAAAAAAAD1"])).get("msg_AAAAAAAAAAD1");
    const hidden = (await repos.chatLinkPreviews.hiddenKeys(["msg_AAAAAAAAAAD1"])).get("msg_AAAAAAAAAAD1");
    const cards = withLinkPreviews(parseUnfurls({ attachments: [card(TWO)] }, { bot: true, body: TEXT }).unfurls, previews, hidden);
    expect(cards.map((c) => (c.kind === "card" ? c.titleLink : null))).toEqual([TWO]);
  });

  it("matches the preview by where the link ended up, and keys the mark by the address as written", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", channel: "C1", ts: "1.1", before: [card("https://example.test/final")], previews: [] }]);
    dataset.chatLinkPreviews.push(preview("msg_AAAAAAAAAAD1", "https://short.test/x", { final_url: "https://example.test/final" }));
    await hideHubPreviewsRemovedInSlack(supabase, [incoming("C1", "1.1", [])]);
    expect(await hiddenOf("msg_AAAAAAAAAAD1")).toEqual(["url:https://short.test/x"]);
  });

  it("is idempotent: running it again, or after the Hub's own removal, changes nothing", async () => {
    seed([{ id: "msg_AAAAAAAAAAD1", channel: "C1", ts: "1.1", before: [card(ONE)], previews: [ONE] }]);
    const repos = (await import("@/lib/data/repos")).createRepos(supabase);
    await repos.chatLinkPreviews.hide("msg_AAAAAAAAAAD1", `url:${ONE}`);
    await hideHubPreviewsRemovedInSlack(supabase, [incoming("C1", "1.1", [])]);
    await hideHubPreviewsRemovedInSlack(supabase, [incoming("C1", "1.1", [])]);
    expect(await hiddenOf("msg_AAAAAAAAAAD1")).toEqual([`url:${ONE}`]);
  });

  it("marks nothing on first arrival, on an edit, for a Slack-written message, or for a link the Hub has no preview of", async () => {
    seed([
      { id: "msg_AAAAAAAAAAD1", channel: "C1", ts: "1.1", before: [], previews: [ONE] },
      { id: "msg_AAAAAAAAAAD2", channel: "C1", ts: "1.2", before: [card(ONE)], previews: [ONE] },
      { id: "msg_AAAAAAAAAAD3", channel: "C1", ts: "1.3", before: [card(ONE)], previews: [ONE], origin: "slack" },
      { id: "msg_AAAAAAAAAAD4", channel: "C1", ts: "1.4", before: [card(ONE)], previews: [] },
    ]);
    const count = await hideHubPreviewsRemovedInSlack(supabase, [
      incoming("C1", "1.1", [card(ONE)]),
      incoming("C1", "1.2", [], "edited, no link"),
      incoming("C1", "1.3", []),
      incoming("C1", "1.4", []),
    ]);
    expect(count).toBe(0);
    for (const id of ["msg_AAAAAAAAAAD1", "msg_AAAAAAAAAAD2", "msg_AAAAAAAAAAD3", "msg_AAAAAAAAAAD4"]) expect(await hiddenOf(id)).toEqual([]);
  });

  it("handles a whole import batch across channels (and a timestamp shared by two channels) in one pass", async () => {
    seed([
      { id: "msg_AAAAAAAAAAD1", channel: "C1", ts: "5.5", before: [card(ONE)], previews: [ONE] },
      { id: "msg_AAAAAAAAAAD2", channel: "C2", ts: "5.5", before: [card(ONE)], previews: [ONE] },
      ...Array.from({ length: 250 }, (_, i) => ({ id: `msg_B${String(i).padStart(11, "0")}`, channel: "C3", ts: `9.${i}`, before: [] as unknown[], previews: [] as string[] })),
    ]);
    const batch = [incoming("C1", "5.5", []), incoming("C2", "5.5", [card(ONE)]), ...Array.from({ length: 250 }, (_, i) => incoming("C3", `9.${i}`, []))];
    expect(await hideHubPreviewsRemovedInSlack(supabase, batch)).toBe(1);
    expect(await hiddenOf("msg_AAAAAAAAAAD1")).toEqual([`url:${ONE}`]);
    expect(await hiddenOf("msg_AAAAAAAAAAD2")).toEqual([]);
  });

  it("ignores payloads that are not message objects and never throws", async () => {
    expect(await hideHubPreviewsRemovedInSlack(supabase, [{ channel_id: "C1", message_ts: "1.1", raw_payload: null }])).toBe(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    dataset = null as never;
    expect(await hideHubPreviewsRemovedInSlack(supabase, [incoming("C1", "1.1", [])])).toBe(0);
  });
});

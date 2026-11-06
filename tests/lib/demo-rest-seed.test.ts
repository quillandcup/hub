import { describe, expect, it } from "vitest";
import { DEMO_EVENTS, FORMATTED_DESCRIPTION, eventCalendarRows, eventImagePng, withFormattedDescription } from "@/demo/rest-seed";
import { hasEventTag } from "@/lib/calendar-events";
import { plainTextDescription } from "@/lib/prickle-types";
import { orgDate } from "@/demo/seed";
import { botIdentity, linkPreviewPage, slackHomePage } from "@/demo/mockups/rest-frames";

const now = new Date("2026-11-06T15:00:00Z");

describe("the demo's Events items", () => {
  const rows = eventCalendarRows(now, orgDate);

  it("tags every item #event, so the app's own processing makes the events", () => {
    expect(rows).toHaveLength(DEMO_EVENTS.length);
    for (const row of rows) expect(hasEventTag(row.description)).toBe(true);
  });

  it("gives ids that never collide with the weekly prickles and that the seed's cleanup keeps", () => {
    const ids = rows.map((r) => r.google_event_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("demo-ev-") || id.startsWith("demo-"))).toBe(true);
  });

  it("has upcoming and past events, and a multi-day retreat that runs whole days", () => {
    expect(rows.some((r) => new Date(r.start_time) > now)).toBe(true);
    expect(rows.some((r) => new Date(r.end_time) < now)).toBe(true);
    const retreat = rows.find((r) => r.google_event_id === "demo-ev-retreat")!;
    expect(new Date(retreat.end_time).getTime() - new Date(retreat.start_time).getTime()).toBeGreaterThanOrEqual(3 * 23 * 3_600_000);
  });

  it("draws a landscape picture", async () => {
    const png = await eventImagePng(["#1f4e5f", "#e0b94f"]);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("withFormattedDescription", () => {
  const row = (summary: string, start: string) => ({ summary, start_time: start, description: null as string | null });

  it("describes the next Sprint Prickle after tomorrow, and only that one", () => {
    const rows = [
      row("Sprint Prickle w/Hazel Hosting", "2026-10-30T23:00:00Z"),
      row("Sprint Prickle w/Hazel Hosting", "2026-11-07T01:00:00Z"),
      row("Sprint Prickle w/Hazel Hosting", "2026-11-15T00:00:00Z"),
      row("Sprint Prickle w/Hazel Hosting", "2026-11-22T00:00:00Z"),
      row("Progress Prickle w/Hazel Hosting", "2026-11-09T14:00:00Z"),
    ];
    withFormattedDescription(rows, now);
    expect(rows.map((r) => r.description !== null)).toEqual([false, false, true, false, false]);
  });

  it("does nothing without a Sprint Prickle ahead", () => {
    const rows = [row("Progress Prickle", "2026-11-09T14:00:00Z")];
    expect(withFormattedDescription(rows, now)[0].description).toBeNull();
  });

  it("is a description the app turns into bold, italic, a list, a link and a rule", () => {
    const markdown = plainTextDescription(FORMATTED_DESCRIPTION) ?? "";
    expect(markdown).toContain("**Bring a scene that is stuck.**");
    expect(markdown).toContain("*one*");
    expect(markdown).toMatch(/^- Read your stuck scene aloud/m);
    expect(markdown).toContain("[our list of prompts](https://example.com/stuck-scene-prompts)");
    expect(markdown).toMatch(/^---$/m);
  });
});

describe("the mockup frames", () => {
  it("draws a link card from the preview's tags", () => {
    const html = linkPreviewPage({ url: "https://hub.example.com/login", title: "A & B <c>", description: "d", image: "data:image/png;base64,AA==" }, "Maya Example");
    expect(html).toContain("A &amp; B &lt;c&gt;");
    expect(html).toContain("hub.example.com");
  });

  it("draws the Home tab around given blocks", () => {
    const { name, logo } = botIdentity();
    const html = slackHomePage([{ type: "section", text: { type: "mrkdwn", text: "*Hello*" } }], name, logo);
    expect(html).toContain("data-frame");
    expect(html).toContain("Home");
  });
});

import { describe, it, expect } from "vitest";
import { DEFAULT_SLACK_SORT, parseSlackPageQuery } from "@/lib/slack-activity-table";

describe("parseSlackPageQuery", () => {
  it("defaults to everything, newest first, page 1", () => {
    expect(parseSlackPageQuery({})).toEqual({ kind: "all", channel: null, sort: DEFAULT_SLACK_SORT, page: 1, pageSize: 50 });
  });

  it("reads the filters, sort and paging from the URL", () => {
    expect(parseSlackPageQuery({ type: "reactions", channel: "writing", sort: "channel", dir: "asc", page: "3", pageSize: "25" })).toEqual({
      kind: "reactions",
      channel: "writing",
      sort: { column: "channel", direction: "asc" },
      page: 3,
      pageSize: 25,
    });
  });

  it("ignores values it doesn't know", () => {
    const query = parseSlackPageQuery({ type: "bogus", sort: "data->>x", channel: "", page: "-2" });
    expect(query).toMatchObject({ kind: "all", channel: null, sort: DEFAULT_SLACK_SORT, page: 1 });
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseSlackPageQuery({ type: ["messages", "reactions"] }).kind).toBe("messages");
  });
});

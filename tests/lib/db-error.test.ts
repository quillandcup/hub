import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DbQueryError, throwIfDbError } from "@/lib/db-error";

describe("db-error", () => {
  it("names the section and flags a statement timeout", () => {
    const error = new DbQueryError("feed", { code: "57014", message: "canceling statement" });
    expect(error.name).toBe("DbStatementTimeout");
    expect(error.message).toBe("feed: canceling statement (57014)");
  });

  it("throws only when there is an error", () => {
    expect(() => throwIfDbError("feed", null)).not.toThrow();
    expect(() => throwIfDbError("feed", { message: "boom" })).toThrow(DbQueryError);
  });

  // lib/activity-feed is imported by client components (RecordHistoryButton), so a server-only
  // import here ships the Slack client and node:fs to the browser and crashes every page using it.
  it("keeps client-reachable modules free of server-only imports", () => {
    expect(readFileSync("lib/db-error.ts", "utf8")).not.toMatch(/^import /m);
    expect(readFileSync("lib/activity-feed.ts", "utf8")).not.toContain("@/lib/query-trace");
  });
});

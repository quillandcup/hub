import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// supabase/seed.sql runs on every `supabase start` (locally and in CI) after the migrations. A
// `TRUNCATE ... CASCADE` there also empties every table that references the truncated one, however
// far away: events point at calendar events, badge types at events, so truncating the calendar
// table that way once emptied the badge definitions and failed an unrelated pgTAP test.

const seed = readFileSync("supabase/seed.sql", "utf8");
const statements = seed
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim());

describe("supabase/seed.sql", () => {
  it("clears the Bronze calendar table with DELETE, so what references it keeps its rows", () => {
    expect(statements.some((s) => /^DELETE FROM bronze\.calendar_events$/i.test(s))).toBe(true);
    expect(statements.some((s) => /^TRUNCATE\s+bronze\.calendar_events/i.test(s))).toBe(false);
  });

  it("clears members with DELETE too: a cascading truncate reaches events through a media asset's owner and image, and badge_types through events", () => {
    expect(statements.some((s) => /^DELETE FROM members$/i.test(s))).toBe(true);
    expect(statements.some((s) => /^TRUNCATE\s+(public\.)?members\b/i.test(s))).toBe(false);
  });

  it("deletes the two tables whose key to members blocks a delete before the members", () => {
    const at = (re: RegExp) => statements.findIndex((s) => re.test(s));
    const members = at(/^DELETE FROM members$/i);
    expect(at(/^DELETE FROM feedback$/i)).toBeGreaterThanOrEqual(0);
    expect(at(/^DELETE FROM feedback$/i)).toBeLessThan(members);
    expect(at(/^DELETE FROM ambiguous_zoom_names$/i)).toBeGreaterThanOrEqual(0);
    expect(at(/^DELETE FROM ambiguous_zoom_names$/i)).toBeLessThan(members);
  });

  it("no longer drops and re-adds a foreign key around the clearing", () => {
    expect(statements.some((s) => /^ALTER TABLE .* (DROP|ADD) CONSTRAINT/i.test(s))).toBe(false);
  });
});

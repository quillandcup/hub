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

  it("keeps the events image key out of the cascading truncate of members, which would empty badge_types through events", () => {
    const at = (re: RegExp) => statements.findIndex((s) => re.test(s));
    const drop = at(/^ALTER TABLE public\.events DROP CONSTRAINT events_image_id_fkey$/i);
    const truncate = at(/^TRUNCATE members CASCADE$/i);
    const restore = at(/^ALTER TABLE public\.events ADD CONSTRAINT events_image_id_fkey FOREIGN KEY \(image_id\) REFERENCES public\.media_assets\(id\) ON DELETE RESTRICT$/i);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(drop).toBeLessThan(truncate);
    expect(truncate).toBeLessThan(restore);
  });
});

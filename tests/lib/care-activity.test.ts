import { describe, expect, it } from "vitest";
import { careStartInstant } from "@/lib/care";
import { PLAN_ACTIVITY_PAGE_SIZE, PLAN_EMAIL_TYPES, PLAN_MEMBER_TYPES, planActivityLabel, planActivityWindow } from "@/lib/care-activity";
import { PARTICIPATION_TYPES } from "@/lib/care-participation";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

describe("the window of a care plan", () => {
  it("runs from when it opened to when it closed, or to now while it is open", () => {
    const now = new Date("2027-03-20T15:00:00Z");
    expect(planActivityWindow({ opened_at: "2027-03-01T17:00:00Z", closed_at: null }, now)).toEqual({ fromIso: "2027-03-01T17:00:00.000Z", toIso: "2027-03-20T15:00:00.000Z" });
    expect(planActivityWindow({ opened_at: "2027-03-01T17:00:00Z", closed_at: "2027-03-10T16:00:00Z" }, now)).toEqual({ fromIso: "2027-03-01T17:00:00.000Z", toIso: "2027-03-10T16:00:00.000Z" });
  });

  // A care plan started on an earlier day opens at noon Eastern of it (careStartInstant). Rows a minute either side of that instant
  // and of the Eastern midnights around it: the start is in, the end is out, whatever the offset from UTC that day.
  describe.each([
    ["an ordinary winter day", "2027-01-15", "2027-01-20"],
    ["the day clocks go forward", "2027-03-14", "2027-03-16"],
    ["the day clocks go back", "2027-11-07", "2027-11-09"],
  ])("%s", (_name, startDay, endDay) => {
    const now = new Date("2027-12-01T15:00:00Z");
    const opened = careStartInstant(startDay, now);
    const closed = careStartInstant(endDay, now);
    const MEMBER = "mbr_AAAAAAAAAAA1";

    it("counts the opening instant, not the closing one, and nothing a moment either side", async () => {
      const data = new InMemoryDataset({ members: [{ id: MEMBER, name: "Ada Example", email: "ada@example.test" }] });
      const repos = createInMemoryRepos(data);
      const at = (ms: number) => new Date(ms).toISOString();
      for (const [title, ms] of [
        ["a minute before", opened.getTime() - 60_000],
        ["the opening", opened.getTime()],
        ["a minute after", opened.getTime() + 60_000],
        ["a minute before the close", closed.getTime() - 60_000],
        ["the close", closed.getTime()],
      ] as const) {
        await repos.activities.record({ memberId: MEMBER, type: "prickle_attended", category: "event", title, occurredAt: at(ms), source: "prickle_attendance", relatedId: title, actorKind: "member" });
      }
      const { fromIso, toIso } = planActivityWindow({ opened_at: opened.toISOString(), closed_at: closed.toISOString() }, now);

      const found = await repos.activities.planActivity({ memberId: MEMBER, fromIso, toIso, carePlanId: "care_AAAAAAAAAAA1", page: 1, pageSize: PLAN_ACTIVITY_PAGE_SIZE });

      expect(found.rows.map((r) => r.title)).toEqual(["a minute before the close", "a minute after", "the opening"]);
    });

    it("opens at noon Eastern of the day it started, an instant that exists on every day, including the two clock-change days", () => {
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(opened));
      expect(hour).toBe(12);
    });
  });
});

describe("what is listed", () => {
  it("is the participation vocabulary and the emails, without logins or anything staff or the system wrote", () => {
    expect(PLAN_MEMBER_TYPES).toEqual(PARTICIPATION_TYPES);
    expect(PLAN_MEMBER_TYPES).not.toContain("hedgie_hub_login");
    expect(PLAN_EMAIL_TYPES).toEqual(["email_sent", "email_opened", "email_clicked", "email_bounced"]);
  });

  it("labels a row by its stored title, and says writing in fixed words because a title can name a project", () => {
    expect(planActivityLabel({ activity_type: "slack_message", title: "Posted in #writing" })).toBe("Posted in #writing");
    expect(planActivityLabel({ activity_type: "writing_progress_logged", title: "Logged 500 words on Moon Garden" })).toBe("Logged writing progress");
    expect(planActivityLabel({ activity_type: "prickle_attended", title: null })).toBe("prickle attended");
  });
});

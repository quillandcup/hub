import { describe, it, expect } from "vitest";
import {
  INTRO_SCHEDULE,
  introNudgeMessage,
  nudgeDue,
  PRICKLE_SCHEDULE,
  prickleNudgeMessage,
  prickleNudgeVariant,
} from "@/lib/member-reminders";
import { calendarDaysBetween, currentHour, jitteredGapDays, SEND_HOUR_COUNT, SEND_HOUR_START, sendHourFor } from "@/lib/nudge-jitter";
import { APP_URL, ATTENDANCE_DATA_STARTS_ON, SLACK_INTRO_CHANNEL, SLACK_WORKSPACE_URL } from "@/lib/config";

const NOW = new Date("2026-10-13T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("nudgeDue", () => {
  it("waits out the first days after joining", () => {
    expect(nudgeDue(INTRO_SCHEDULE, INTRO_SCHEDULE.firstAfterDays - 1, [], NOW)).toBe(false);
    expect(nudgeDue(INTRO_SCHEDULE, INTRO_SCHEDULE.firstAfterDays, [], NOW)).toBe(true);
    expect(nudgeDue(INTRO_SCHEDULE, null, [], NOW)).toBe(false);
  });

  it("spaces intro reminders by a week and stops after the cap", () => {
    expect(nudgeDue(INTRO_SCHEDULE, 20, [daysAgo(6)], NOW)).toBe(false);
    expect(nudgeDue(INTRO_SCHEDULE, 20, [daysAgo(7)], NOW)).toBe(true);
    const four = [daysAgo(60), daysAgo(50), daysAgo(40), daysAgo(30)];
    expect(nudgeDue(INTRO_SCHEDULE, 80, four, NOW)).toBe(false);
  });

  it("backs off prickle reminders, from weekly to biweekly to monthly, and never stops", () => {
    const sent = (n: number) => Array.from({ length: n }, (_, i) => daysAgo(400 - i));
    const dueAfter = (n: number, lastDaysAgo: number) =>
      nudgeDue(PRICKLE_SCHEDULE, 900, [...sent(n - 1), daysAgo(lastDaysAgo)], NOW);
    // Each gap is jittered, so check just outside its range: 7 days is 6-8, 14 is 12-16, 30 is 25-35.
    expect(dueAfter(1, 5)).toBe(false);
    expect(dueAfter(1, 8)).toBe(true);
    expect(dueAfter(5, 11)).toBe(false);
    expect(dueAfter(5, 16)).toBe(true);
    expect(dueAfter(9, 24)).toBe(false);
    expect(dueAfter(9, 35)).toBe(true);
    expect(nudgeDue(PRICKLE_SCHEDULE, 900, sent(200).concat(daysAgo(35)), NOW)).toBe(true);
  });
});

describe("messages", () => {
  it("points the intro reminder at the Slack channel, tagged so it can be marked read", () => {
    const message = introNudgeMessage("C123");
    expect(message.text).toContain(`#${SLACK_INTRO_CHANNEL}`);
    expect(message.url).toBe(`${SLACK_WORKSPACE_URL}/app_redirect?channel=C123`);
    expect(message.ref).toBe("intro");
    expect(introNudgeMessage(null).url).toBeUndefined();
  });

  it("points the prickle reminder at the prickle list", () => {
    const message = prickleNudgeMessage("next");
    expect(message.url).toBe(`${APP_URL}/my-prickles`);
    expect(message.ref).toBe("prickle");
  });

  it("only says first to someone we can see the whole history of", () => {
    expect(prickleNudgeVariant(ATTENDANCE_DATA_STARTS_ON, null)).toBe("first");
    expect(prickleNudgeVariant("2022-03-01", null)).toBe("next");
    expect(prickleNudgeVariant(null, null)).toBe("next");
    expect(prickleNudgeVariant("2022-03-01", daysAgo(90))).toBe("lapsed");
    expect(prickleNudgeVariant(ATTENDANCE_DATA_STARTS_ON, daysAgo(90))).toBe("lapsed");
    expect(prickleNudgeMessage("first").text).toContain("first");
    expect(prickleNudgeMessage("next").text).not.toContain("first");
    expect(prickleNudgeMessage("lapsed").text).toContain("miss");
  });
});

describe("jitter", () => {
  it("gives each member a stable daytime send hour, spread across the window", () => {
    const hours = Array.from({ length: 200 }, (_, i) => sendHourFor(`member-${i}:prickle_nudge`));
    expect(hours.every((h) => h >= SEND_HOUR_START && h < SEND_HOUR_START + SEND_HOUR_COUNT)).toBe(true);
    expect(new Set(hours).size).toBe(SEND_HOUR_COUNT);
    expect(sendHourFor("member-1:prickle_nudge")).toBe(sendHourFor("member-1:prickle_nudge"));
  });

  it("picks a different hour for each reminder, so a member isn't always reached at the same time", () => {
    const hours = Array.from({ length: 8 }, (_, n) => sendHourFor(`member-1:prickle_nudge:${n}`));
    expect(new Set(hours).size).toBeGreaterThan(3);
  });

  it("counts gaps in calendar days in the org timezone, whatever hour each reminder went out", () => {
    const lateMorning = new Date("2026-10-06T17:00:00Z"); // 1pm in New York
    const earlyMorning = new Date("2026-10-13T13:00:00Z"); // 9am, a week later
    expect(calendarDaysBetween(lateMorning, earlyMorning)).toBe(7);
    // 11pm in New York on the 6th is already the 7th in UTC
    expect(calendarDaysBetween(new Date("2026-10-07T03:00:00Z"), new Date("2026-10-13T13:00:00Z"))).toBe(7);
  });

  it("measures a gap in the member's own calendar days", () => {
    // 11pm Oct 6 in New York is already Oct 7 in London
    const last = new Date("2026-10-07T03:00:00Z");
    const now = new Date("2026-10-14T03:00:00Z");
    expect(calendarDaysBetween(last, now, "America/New_York")).toBe(7);
    expect(calendarDaysBetween(last, now, "Europe/London")).toBe(7);
    expect(calendarDaysBetween(last, new Date("2026-10-13T23:30:00Z"), "Asia/Tokyo")).toBe(7);
    expect(calendarDaysBetween(last, new Date("2026-10-13T23:30:00Z"), "America/New_York")).toBe(7);
    expect(calendarDaysBetween(last, new Date("2026-10-13T03:00:00Z"), "America/New_York")).toBe(6);
  });

  it("reads the hour in the given timezone", () => {
    expect(currentHour(new Date("2026-10-13T15:00:00Z"), "Europe/London")).toBe(16);
    expect(currentHour(new Date("2026-10-13T15:00:00Z"), "Asia/Tokyo")).toBe(0);
  });

  it("reads the hour in the org timezone", () => {
    expect(currentHour(new Date("2026-10-13T15:00:00Z"), "America/New_York")).toBe(11);
    expect(currentHour(new Date("2026-01-13T15:00:00Z"), "America/New_York")).toBe(10);
  });

  it("moves a weekly gap to 6-8 days, differently after each reminder, so the weekday drifts", () => {
    const gaps = Array.from({ length: 60 }, (_, i) => jitteredGapDays(7, `m:${i}`));
    expect(Math.min(...gaps)).toBe(6);
    expect(Math.max(...gaps)).toBe(8);
    expect(jitteredGapDays(30, "m:1")).toBeGreaterThanOrEqual(25);
    expect(jitteredGapDays(30, "m:1")).toBeLessThanOrEqual(35);
  });

  it("applies the jittered gap when deciding a reminder is due", () => {
    const keys = Array.from({ length: 60 }, (_, i) => `m${i}:prickle_nudge`);
    const dueAfter = (days: number) => keys.filter((k) => nudgeDue(PRICKLE_SCHEDULE, 900, [daysAgo(days)], NOW, k)).length;
    expect(dueAfter(5)).toBe(0);
    expect(dueAfter(6)).toBeGreaterThan(0);
    expect(dueAfter(6)).toBeLessThan(keys.length);
    expect(dueAfter(8)).toBe(keys.length);
  });
});

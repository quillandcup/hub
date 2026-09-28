import { describe, it, expect } from "vitest";
import { escapeText, foldLine, formatDate, formatUtc, renderICalendar } from "@/lib/ical";

describe("escapeText", () => {
  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("formatUtc", () => {
  it("formats a UTC DATE-TIME without separators or milliseconds", () => {
    expect(formatUtc(new Date("2026-09-28T14:05:09.123Z"))).toBe("20260928T140509Z");
  });
});

describe("formatDate", () => {
  it("formats a DATE from the UTC calendar date", () => {
    expect(formatDate(new Date("2026-10-09T00:00:00Z"))).toBe("20261009");
  });
});

describe("foldLine", () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;

  it("leaves lines of 75 octets or fewer alone", () => {
    const line = "x".repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it("folds longer lines into 75-octet physical lines with space continuations", () => {
    const folded = foldLine("x".repeat(200));
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const line of physical) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(physical.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(physical.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe("x".repeat(200));
  });

  it("never splits a multi-byte character", () => {
    const folded = foldLine("🦔".repeat(40));
    for (const line of folded.split("\r\n")) {
      expect(octets(line)).toBeLessThanOrEqual(75);
      expect(line).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe("🦔".repeat(40));
  });
});

describe("renderICalendar", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const ics = renderICalendar(
    {
      name: "My Prickles · Hedgie Hub",
      description: "Hosted, and committed",
      refreshMinutes: 60,
      events: [
        {
          uid: "abc@hub.quillandcup.com",
          start: new Date("2026-09-29T11:00:00Z"),
          end: new Date("2026-09-29T12:00:00Z"),
          summary: "Hosting: Progress Prickle",
          description: "Line one\nLine two",
          url: "https://hub.quillandcup.com/prickles/p1",
          reminderMinutes: 15,
        },
        {
          uid: "def@hub.quillandcup.com",
          start: new Date("2026-09-30T11:00:00Z"),
          end: new Date("2026-09-30T12:00:00Z"),
          summary: "Sprint",
          status: "TENTATIVE",
        },
        {
          uid: "retreat@hub.quillandcup.com",
          start: new Date("2026-10-09T00:00:00Z"),
          end: new Date("2026-10-12T00:00:00Z"),
          allDay: true,
          summary: "Fall Retreat",
          location: "Asheville, NC",
        },
      ],
    },
    now
  );
  const lines = ics.split("\r\n");

  it("writes all-day events as DATE values with an exclusive end, plus a location", () => {
    expect(lines).toContain("DTSTART;VALUE=DATE:20261009");
    expect(lines).toContain("DTEND;VALUE=DATE:20261012");
    expect(lines).toContain("LOCATION:Asheville\\, NC");
  });

  it("uses CRLF line endings throughout and ends with one", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes the calendar header with name and refresh hints", () => {
    expect(lines.slice(0, 5)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Quill & Cup//Hedgie Hub//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ]);
    expect(lines).toContain("X-WR-CALNAME:My Prickles · Hedgie Hub");
    expect(lines).toContain("X-WR-CALDESC:Hosted\\, and committed");
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT60M");
    expect(lines).toContain("X-PUBLISHED-TTL:PT60M");
  });

  it("writes each event with UTC times, escaped text, URL, status and reminder", () => {
    expect(lines).toContain("UID:abc@hub.quillandcup.com");
    expect(lines).toContain("DTSTAMP:20260928T120000Z");
    expect(lines).toContain("DTSTART:20260929T110000Z");
    expect(lines).toContain("DTEND:20260929T120000Z");
    expect(lines).toContain("SUMMARY:Hosting: Progress Prickle");
    expect(lines).toContain("DESCRIPTION:Line one\\nLine two");
    expect(lines).toContain("URL:https://hub.quillandcup.com/prickles/p1");
    expect(lines).toContain("TRIGGER:-PT15M");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(3);
    expect(lines.filter((l) => l === "BEGIN:VALARM")).toHaveLength(1);
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).toContain("STATUS:TENTATIVE");
  });
});

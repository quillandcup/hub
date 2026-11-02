// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ChatAdoption, type ChatPersonRow, type ChatWeekRow } from "@/app/(admin)/admin/analytics/ChatAdoption";

const weekly: ChatWeekRow[] = [
  { week_start: "2026-10-25", hub_messages: 1, slack_messages: 9, hub_authors: 1, slack_authors: 6 },
  { week_start: "2026-11-01", hub_messages: 30, slack_messages: 70, hub_authors: 12, slack_authors: 20 },
];
const person = (n: number, hub: number, slack: number, display: string | null = null): ChatPersonRow => ({
  member_id: `mbr_AAAAAAAAAA${n}`,
  name: `Legal Name ${n}`,
  display_name: display,
  hub_messages: hub,
  slack_messages: slack,
});

describe("ChatAdoption", () => {
  it("shows the share of messages written in the Hub, in total", () => {
    render(<ChatAdoption weekly={weekly} people={[person(1, 5, 5)]} days={30} />);
    const section = within(screen.getByRole("region", { name: "Chat adoption" }));
    expect(section.getByText("Written in the Hub").nextElementSibling).toHaveTextContent("28%");
    expect(section.getByText("31 of 110 messages")).toBeInTheDocument();
    expect(screen.getByText(/in the last 30 days/)).toBeInTheDocument();
  });

  it("splits the people who wrote into only Hub, both and only Slack", () => {
    const people = [person(1, 4, 0), person(2, 3, 3), person(3, 0, 8), person(4, 0, 2), person(5, 0, 1)];
    render(<ChatAdoption weekly={weekly} people={people} days={30} />);
    const tile = screen.getByText("People who wrote in the Hub").closest("div")!;
    expect(tile).toHaveTextContent("40%");
    expect(tile).toHaveTextContent("2 of 5 people who wrote (1 only in the Hub, 1 in both, 3 only in Slack)");
  });

  it("lists the weeks with their Hub share and how many people wrote", () => {
    render(<ChatAdoption weekly={weekly} people={[]} days={30} />);
    const table = within(screen.getByRole("table", { name: /By week/ }));
    const rows = table.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Oct 25");
    expect(rows[1]).toHaveTextContent("10%");
    expect(rows[2]).toHaveTextContent("Nov 1");
    expect(rows[2]).toHaveTextContent("30 (12 people)");
    expect(rows[2]).toHaveTextContent("30%");
  });

  it("shows the ten who wrote most, by the name they go by, with their share in the Hub", () => {
    const people = Array.from({ length: 12 }, (_, i) => person(i + 1, i === 0 ? 5 : 0, 20 - i, i === 0 ? "Ada C" : null));
    render(<ChatAdoption weekly={weekly} people={people} days={7} />);
    const table = within(screen.getByRole("table", { name: /By person/ }));
    expect(table.getAllByRole("row")).toHaveLength(11);
    expect(table.getByText("Ada C")).toBeInTheDocument();
    expect(table.queryByText("Legal Name 1")).toBeNull();
    expect(table.getByText("Ada C").closest("tr")).toHaveTextContent("20%");
    expect(screen.getByText(/the 10 who wrote most/)).toBeInTheDocument();
  });

  it("says so when nobody wrote anything in the window", () => {
    render(<ChatAdoption weekly={[]} people={[]} days={7} />);
    expect(screen.getByText("No messages in this window.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

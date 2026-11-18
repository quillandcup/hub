// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SlackEngagementCharts from "@/app/(admin)/admin/insights/slack-engagement/SlackEngagementCharts";
import { tooltipText } from "@/tests/helpers/tooltip";

afterEach(cleanup);

describe("SlackEngagementCharts day and hour heatmap", () => {
  it("names each cell for a screen reader and gives it the same text as a tooltip, with the right plural", () => {
    render(
      <SlackEngagementCharts
        heatmap={[
          { day: "Mon", hour: 9, count: 1 },
          { day: "Mon", hour: 15, count: 4 },
        ]}
        channels={[]}
        archivalCandidates={[]}
        topEmoji={[]}
        sinceLabel="last month"
      />
    );

    const one = screen.getByLabelText("Mon 9a: 1 events");
    const many = screen.getByLabelText("Mon 3p: 4 events");
    expect(tooltipText(one)).toBe("Mon 9a ET · 1 event");
    expect(tooltipText(many)).toBe("Mon 3p ET · 4 events");
  });
});

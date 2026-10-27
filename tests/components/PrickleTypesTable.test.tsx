// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PrickleTypesTable, { type PrickleTypeRow } from "@/app/(admin)/admin/data/prickle-types/PrickleTypesTable";

const row = (over: Partial<PrickleTypeRow>): PrickleTypeRow => ({
  id: "prty_AAAAAAAAAAA1",
  name: "Educational Prickle",
  normalized_name: "educational",
  description: null,
  purpose: "work",
  solo_task_friendly: false,
  listed_in_events: true,
  announced_publicly: false,
  guests_allowed: false,
  ...over,
});

describe("PrickleTypesTable default host and other names", () => {
  it("shows each type's default host and the other names its calendar titles use", () => {
    render(
      <PrickleTypesTable
        rows={[
          row({ default_host_name: "Ada Example", summary_aliases: ["edu", "learn"] }),
          row({ id: "prty_AAAAAAAAAAA2", name: "Heads Down", normalized_name: "heads-down", default_host_name: null, summary_aliases: [] }),
        ]}
      />,
    );

    expect(screen.getByText("Ada Example")).toBeInTheDocument();
    expect(screen.getByText("also: edu, learn")).toBeInTheDocument();
    expect(screen.getAllByText("also:", { exact: false })).toHaveLength(1);
  });
});

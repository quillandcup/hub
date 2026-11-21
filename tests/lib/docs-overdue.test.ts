import { describe, expect, it } from "vitest";
import {
  dueDate,
  orgToday,
  overdueDocs,
  overdueMarkdown,
  parseReview,
  readLivingDocs,
  type LivingDoc,
} from "../../scripts/docs-overdue";
import path from "node:path";

const doc = (p: string, lastReviewed: string, cadence: LivingDoc["cadence"]): LivingDoc => ({ path: p, lastReviewed, cadence });

describe("dueDate", () => {
  it("adds three months for quarterly and a year for yearly", () => {
    expect(dueDate("2026-01-15", "quarterly")).toBe("2026-04-15");
    expect(dueDate("2026-11-20", "quarterly")).toBe("2027-02-20");
    expect(dueDate("2026-11-20", "yearly")).toBe("2027-11-20");
  });

  it("clamps to the end of a shorter month", () => {
    expect(dueDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(dueDate("2028-02-29", "yearly")).toBe("2029-02-28");
  });
});

describe("overdueDocs", () => {
  it("is on time on the due date and overdue the day after", () => {
    const docs = [doc("a.md", "2026-01-15", "quarterly")];
    expect(overdueDocs(docs, "2026-04-14")).toEqual([]);
    expect(overdueDocs(docs, "2026-04-15")).toEqual([]);
    expect(overdueDocs(docs, "2026-04-16")).toEqual([{ ...docs[0], dueOn: "2026-04-15", daysOverdue: 1 }]);
  });

  it("counts a yearly doc across a leap day", () => {
    const docs = [doc("a.md", "2027-02-28", "yearly")];
    expect(overdueDocs(docs, "2028-02-28")).toEqual([]);
    expect(overdueDocs(docs, "2028-03-01")[0].daysOverdue).toBe(2);
  });

  it("always lists a never-reviewed doc, first", () => {
    const result = overdueDocs([doc("old.md", "2020-01-01", "yearly"), doc("never.md", "never", "yearly")], "2026-11-21");
    expect(result.map((d) => d.path)).toEqual(["never.md", "old.md"]);
    expect(result[0]).toMatchObject({ dueOn: null, daysOverdue: null });
  });

  it("orders by days overdue, then path, and leaves fresh docs out", () => {
    const result = overdueDocs(
      [doc("b.md", "2025-01-01", "yearly"), doc("a.md", "2025-01-01", "yearly"), doc("c.md", "2024-01-01", "yearly"), doc("fresh.md", "2026-11-01", "yearly")],
      "2026-11-21",
    );
    expect(result.map((d) => d.path)).toEqual(["c.md", "a.md", "b.md"]);
  });
});

describe("parseReview", () => {
  it("reads the date and the cadence from a living status line", () => {
    const text = "# T\n\n> **Status:** living. **Last reviewed:** 2026-11-17. Review: quarterly. Kept up to date.\n";
    expect(parseReview(text)).toEqual({ lastReviewed: "2026-11-17", cadence: "quarterly" });
  });

  it("reads never", () => {
    const text = "> **Status:** living. **Last reviewed:** never (known out of date, see docs/TODO.md). Review: yearly. x";
    expect(parseReview(text)).toEqual({ lastReviewed: "never", cadence: "yearly" });
  });

  it("returns null without the fields or for a snapshot", () => {
    expect(parseReview("> **Status:** living. Kept up to date.")).toBeNull();
    expect(parseReview("> **Status:** snapshot, as of 2026-01-01.")).toBeNull();
  });
});

describe("overdueMarkdown", () => {
  it("is empty when nothing is overdue", () => {
    expect(overdueMarkdown([], "2026-11-21")).toBe("");
  });

  it("is a table with how to clear an item", () => {
    const md = overdueMarkdown(overdueDocs([doc("docs/x.md", "never", "yearly"), doc("docs/y.md", "2025-01-01", "yearly")], "2026-11-21"), "2026-11-21");
    expect(md).toContain("| Doc | Last reviewed | Cadence | Days overdue |");
    expect(md).toContain("| `docs/x.md` | never | yearly | never reviewed |");
    expect(md).toContain("| `docs/y.md` | 2025-01-01 | yearly | 324 |");
    expect(md).toContain("bump its `**Last reviewed:**` date");
  });
});

describe("orgToday", () => {
  it("names the org's Eastern day, not the UTC one", () => {
    expect(orgToday(Date.UTC(2026, 10, 21, 3, 30))).toBe("2026-11-20"); // 22:30 Eastern the evening before
    expect(orgToday(Date.UTC(2026, 10, 21, 5, 30))).toBe("2026-11-21"); // 00:30 Eastern
  });
});

describe("readLivingDocs", () => {
  it("finds every living doc in the repo with its review fields", () => {
    const docs = readLivingDocs(path.resolve(__dirname, "../../docs"));
    expect(docs.length).toBeGreaterThan(50);
    expect(docs.every((d) => d.path.startsWith("docs/") && !d.path.startsWith("docs/decisions/"))).toBe(true);
  });
});

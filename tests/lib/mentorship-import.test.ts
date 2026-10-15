import { describe, expect, it } from "vitest";
import { parseCsv, planImport, toImportRows } from "@/lib/mentorship-import";

const members = [
  { id: "m-ada", name: "Ada Quill", email: "ada@example.test" },
  { id: "m-bea", name: "Bea Moss", email: "bea@example.test" },
  { id: "m-cleo", name: "Cleo Fern", email: "cleo@example.test" },
  { id: "m-cleo2", name: "Cleo Briar", email: "cleo2@example.test" },
];

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes and CRLF line ends", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});

describe("planImport", () => {
  const rows = (csv: string) => toImportRows(parseCsv(csv));

  it("matches by name and reports how", () => {
    const plan = planImport(
      rows("mentor,trial,trial_start,note\nAda Quill,Bea Moss,2026-03-01,financial\n"),
      members,
      [],
      [],
      new Set()
    );
    expect(plan.problems).toEqual([]);
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({ startedOn: "2026-03-01", note: "financial" });
    expect(plan.matches[0].mentor.id).toBe("m-ada");
    expect(plan.matches[0].trial.id).toBe("m-bea");
  });

  it("uses an email column when the name is ambiguous", () => {
    const plan = planImport(
      rows("mentor,trial,trial_start,trial_email\nAda Quill,Cleo,2026-03-01,cleo2@example.test\n"),
      members,
      [],
      [],
      new Set()
    );
    expect(plan.matches[0].trial.id).toBe("m-cleo2");
  });

  it("reports ambiguous and unknown names instead of guessing", () => {
    const plan = planImport(
      rows("mentor,trial,trial_start\nAda Quill,Cleo,2026-03-01\nNobody Here,Bea Moss,2026-03-01\n"),
      members,
      [],
      [],
      new Set()
    );
    expect(plan.matches).toEqual([]);
    expect(plan.problems.map((p) => p.message)).toEqual([
      expect.stringContaining('trial member "Cleo" is ambiguous'),
      expect.stringContaining('big sister "Nobody Here" matches no member'),
    ]);
  });

  it("skips a big sister listed with no trial member, a bad date and a trial already matched", () => {
    const plan = planImport(
      rows("mentor,trial,trial_start\nAda Quill,,\nAda Quill,Bea Moss,soon\nAda Quill,Cleo Fern,2026-03-01\n"),
      members,
      [],
      [],
      new Set(["m-cleo"])
    );
    expect(plan.matches).toEqual([]);
    expect(plan.problems.map((p) => p.message)).toEqual([
      expect.stringContaining("not a YYYY-MM-DD date"),
      expect.stringContaining("already has a big sister"),
    ]);
  });

  it("keeps the later row when a trial member is repeated", () => {
    const plan = planImport(
      rows("mentor,trial,trial_start\nAda Quill,Bea Moss,2026-03-01\nCleo Fern,Bea Moss,2026-03-02\n"),
      members,
      [],
      [],
      new Set()
    );
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0].mentor.id).toBe("m-cleo");
  });

  it("requires the core columns", () => {
    expect(() => toImportRows(parseCsv("who,what\nx,y\n"))).toThrow(/mentor, trial and trial_start/);
  });
});

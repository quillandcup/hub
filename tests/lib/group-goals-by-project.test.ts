import { describe, expect, it } from "vitest";
import { groupConsecutiveByProject } from "@/lib/group-goals-by-project";

const goal = (id: string, projectId: string | null, projectTitle = "Untitled project") => ({ id, projectId, projectTitle });

describe("groupConsecutiveByProject", () => {
  it("has no groups for no goals", () => {
    expect(groupConsecutiveByProject([])).toEqual([]);
  });

  it("makes one group for a single goal", () => {
    expect(groupConsecutiveByProject([goal("g1", "p1", "Novel")])).toEqual([{ projectId: "p1", projectTitle: "Novel", goals: [goal("g1", "p1", "Novel")] }]);
  });

  it("puts the goals of one project, next to each other, under one title, keeping their order", () => {
    const groups = groupConsecutiveByProject([goal("g1", "p1", "Novel"), goal("g2", "p1", "Novel"), goal("g3", "p2", "Essays")]);
    expect(groups.map((g) => [g.projectTitle, g.goals.map((x) => x.id)])).toEqual([
      ["Novel", ["g1", "g2"]],
      ["Essays", ["g3"]],
    ]);
  });

  it("never re-sorts: the same project twice, apart, stays two groups in the order given", () => {
    const groups = groupConsecutiveByProject([goal("g1", "p1", "Novel"), goal("g2", "p2", "Essays"), goal("g3", "p1", "Novel")]);
    expect(groups.map((g) => g.goals.map((x) => x.id))).toEqual([["g1"], ["g2"], ["g3"]]);
  });

  it("groups goals with no project together, apart from any project", () => {
    const groups = groupConsecutiveByProject([goal("g1", null), goal("g2", null), goal("g3", "p1", "Novel")]);
    expect(groups.map((g) => [g.projectId, g.goals.map((x) => x.id)])).toEqual([
      [null, ["g1", "g2"]],
      ["p1", ["g3"]],
    ]);
  });

  it("doesn't change the list it was given", () => {
    const list = [goal("g1", "p1"), goal("g2", "p1")];
    groupConsecutiveByProject(list);
    expect(list.map((g) => g.id)).toEqual(["g1", "g2"]);
  });
});

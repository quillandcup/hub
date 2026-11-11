import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { memberStatusTimeline, recomputeMemberStatus } from "@/lib/member-status";
import { parseDateOnly } from "@/lib/member-tenure";

const ADA = "mbr_AAAAAAAAAAA1";
const hiatus = (start: string, end: string | null) =>
  ({ id: "hia_AAAAAAAAAAA1", member_id: ADA, start_date: start, end_date: end, reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-01-01T00:00:00Z" }) as never;

function repos(setup: (data: InMemoryDataset) => void = () => {}) {
  const data = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.test" }] });
  setup(data);
  return { data, repos: createInMemoryRepos(data) };
}

describe("memberStatusTimeline", () => {
  it("answers null for a member who does not exist", async () => {
    expect(await memberStatusTimeline(repos().repos, "mbr_ZZZZZZZZZZZZ")).toBeNull();
  });

  it("reads a member with no history as a lead at any time", async () => {
    const timeline = await memberStatusTimeline(repos().repos, ADA);
    expect(timeline?.statusAt(new Date("2026-03-01T00:00:00Z"))).toBe("lead");
  });

  it("reads a program as active while it runs and cancelled after, and a hiatus as on hiatus with its own start and end", async () => {
    const { repos: r } = repos((data) => {
      data.programs = [{ id: "prog_AAAAAAAAAAA1", name: "Example Program", includes_membership: false }] as never;
      data.programCohorts = [{ id: "coh_AAAAAAAAAAA1", program_id: "prog_AAAAAAAAAAA1", starts_at: "2026-01-01", expires_at: "2026-06-30" }] as never;
      data.programEnrollments = [{ id: "enr_AAAAAAAAAAA1", member_id: ADA, cohort_id: "coh_AAAAAAAAAAA1", created_at: "2026-01-01T00:00:00Z" }] as never;
      data.memberHiatuses = [hiatus("2026-03-01", "2026-03-31")];
    });
    const timeline = await memberStatusTimeline(r, ADA);

    expect(timeline?.statusAt(new Date("2026-02-15T12:00:00Z"))).toBe("active");
    expect(timeline?.statusAt(new Date("2026-03-15T12:00:00Z"))).toBe("on_hiatus");
    expect(timeline?.statusAt(new Date("2026-05-15T12:00:00Z"))).toBe("active");
    expect(timeline?.statusAt(new Date("2026-08-15T12:00:00Z"))).toBe("cancelled");
  });

  describe("firstLapse", () => {
    const withProgram = (data: InMemoryDataset, hiatuses: ReturnType<typeof hiatus>[] = []) => {
      data.programs = [{ id: "prog_AAAAAAAAAAA1", name: "Example Program", includes_membership: false }] as never;
      data.programCohorts = [{ id: "coh_AAAAAAAAAAA1", program_id: "prog_AAAAAAAAAAA1", starts_at: "2026-01-01", expires_at: "2026-06-30" }] as never;
      data.programEnrollments = [{ id: "enr_AAAAAAAAAAA1", member_id: ADA, cohort_id: "coh_AAAAAAAAAAA1", created_at: "2026-01-01T00:00:00Z" }] as never;
      data.memberHiatuses = hiatuses;
    };
    const at = (day: string) => new Date(`${day}T12:00:00Z`);

    it("finds the first hiatus after a moment, even though they came back, and then the end of the membership", async () => {
      const { repos: r } = repos((data) => withProgram(data, [hiatus("2026-03-01", "2026-03-31")]));
      const timeline = await memberStatusTimeline(r, ADA);

      expect(timeline?.firstLapse(at("2026-02-01"), at("2027-01-01"))).toMatchObject({ status: "on_hiatus" });
      // Date-only history starts at the local midnight of its day (parseDateOnly), as the Membership Timeline reads it.
      expect(timeline?.firstLapse(at("2026-02-01"), at("2027-01-01"))?.at.getTime()).toBe(parseDateOnly("2026-03-01").getTime());
      const later = timeline?.firstLapse(at("2026-03-05"), at("2027-01-01"));
      expect(later).toMatchObject({ status: "cancelled" }); // the program ran out on Jun 30 with nothing after it
      expect(later?.at.getTime()).toBe(parseDateOnly("2026-06-30").getTime());
    });

    it("answers null before anything happened, after it all, or for a member with no history", async () => {
      const { repos: r } = repos((data) => withProgram(data, [hiatus("2026-03-01", "2026-03-31")]));
      const timeline = await memberStatusTimeline(r, ADA);

      expect(timeline?.firstLapse(at("2026-02-01"), at("2026-02-20"))).toBeNull(); // until is before it
      expect(timeline?.firstLapse(at("2026-07-15"), at("2027-01-01"))).toBeNull(); // after the last one
      expect(await (await memberStatusTimeline(repos().repos, ADA))?.firstLapse(at("2026-01-01"), at("2027-01-01"))).toBeNull();
    });

    it("counts only what has happened by `until`, and a lapse exactly at `until`", async () => {
      const { repos: r } = repos((data) => withProgram(data));
      const timeline = await memberStatusTimeline(r, ADA);
      const end = parseDateOnly("2026-06-30");
      expect(timeline?.firstLapse(at("2026-02-01"), new Date(end.getTime() - 1))).toBeNull();
      expect(timeline?.firstLapse(at("2026-02-01"), end)).toMatchObject({ status: "cancelled" });
    });

    it("never reports staff as lapsing", async () => {
      const data = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.test", staffRole: "staff" }] });
      data.memberHiatuses = [hiatus("2026-03-01", null)];
      const timeline = await memberStatusTimeline(createInMemoryRepos(data), ADA);
      expect(timeline?.firstLapse(at("2026-01-01"), at("2027-01-01"))).toBeNull();
    });
  });

  it("reads staff as active whatever their history says", async () => {
    const data = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.test", staffRole: "staff" }] });
    data.memberHiatuses = [hiatus("2000-01-01", null)];
    const timeline = await memberStatusTimeline(createInMemoryRepos(data), ADA);
    expect(timeline?.statusAt(new Date("2026-03-15T12:00:00Z"))).toBe("active");
  });

  it("is the same answer recomputeMemberStatus caches for now", async () => {
    const { repos: r, data } = repos((d) => {
      d.memberHiatuses = [hiatus("2000-01-01", null)];
    });
    expect(await recomputeMemberStatus(r, ADA)).toBe("on_hiatus");
    expect(data.members[0].status).toBe("on_hiatus");
    expect(await recomputeMemberStatus(r, "mbr_ZZZZZZZZZZZZ")).toBeNull();
  });
});

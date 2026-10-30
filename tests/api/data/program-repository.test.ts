import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/data/db";
import { SupabaseProgramRepository } from "@/lib/data/programs";
import { defineProgramContract } from "@/tests/helpers/program-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
// A year per run, so cohorts of other tests never fall in a date window.
const year = 3000 + (Date.now() % 6000);
let counter = 0;
let members: { id: string; name: string; email: string }[] = [];

// Everything the contract stores carries this run's tag in the program name; cohorts and enrollments go with their program.
const clear = async () => {
  const { error } = await db.from("programs").delete().like("slug", `program-%-${RUN}-%`);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const rows = [
    { name: `Ada Example ${RUN}`, display_name: "Ada E.", status: "cancelled", staff_role: null },
    { name: `Bo Example ${RUN}`, display_name: null, status: "active", staff_role: null },
    { name: `Cy Example ${RUN}`, display_name: null, status: "active", staff_role: "staff" },
  ].map((r, i) => ({ ...r, email: `program-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01" }));
  const { data, error } = await db.from("members").insert(rows).select("id, name, email");
  if (error) throw new Error(error.message);
  members = rows.map((r) => data!.find((m) => m.email === r.email)!);
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", members.map((m) => m.id));
});

defineProgramContract("SupabaseProgramRepository", () => ({
  repo: () => new SupabaseProgramRepository(db),
  unique: (label) => `${label} ${RUN} ${++counter}`,
  get members() {
    return members;
  },
  year,
  missingId: "00000000-0000-4000-8000-000000000000",
  clear,
}));

describe("SupabaseProgramRepository database errors", () => {
  // A client whose every query comes back as an error.
  const broken = new SupabaseProgramRepository(
    createClient("http://127.0.0.1:1", "unreachable", {
      global: { fetch: async () => new Response(JSON.stringify({ message: "boom" }), { status: 400, headers: { "content-type": "application/json" } }) },
    }) as unknown as Db,
  );
  const id = "prg_AAAAAAAAAAAA";

  it("throws instead of returning an empty result", async () => {
    await expect(broken.names()).rejects.toThrow("boom");
    await expect(broken.listWithCounts()).rejects.toThrow();
    await expect(broken.byId(id)).rejects.toThrow();
    await expect(broken.idBySlug("x")).rejects.toThrow();
    await expect(broken.create({ name: "x", slug: "x" })).rejects.toThrow();
    await expect(broken.update(id, {})).rejects.toThrow();
    await expect(broken.delete(id)).rejects.toThrow();
    await expect(broken.cohortsWithEnrollments(id)).rejects.toThrow();
    await expect(broken.cohortForMatching(id)).rejects.toThrow();
    await expect(broken.createCohort({ program_id: id, name: "x", starts_at: "2026-01-01", expires_at: "2026-01-02" })).rejects.toThrow();
    await expect(broken.updateCohort(id, {})).rejects.toThrow();
    await expect(broken.deleteCohort(id)).rejects.toThrow();
    await expect(broken.enrolledElsewhere(id, id, [id])).rejects.toThrow();
    await expect(broken.enroll({ member_id: id, cohort_id: id })).rejects.toThrow("boom");
    await expect(broken.unenroll(id)).rejects.toThrow();
    await expect(broken.memberIdsInCohort(id)).rejects.toThrow();
    await expect(broken.moveEnrollments(id, id)).rejects.toThrow();
    await expect(broken.enrollmentsOf(id)).rejects.toThrow();
    await expect(broken.allEnrollmentCohorts()).rejects.toThrow();
    await expect(broken.membershipArrivals("2026-01-01", "2026-01-02")).rejects.toThrow();
  });

  it("throws from the second half of a move and from the cohort lookup of enrolledElsewhere", async () => {
    // A client that answers the cohort list but fails everything after it.
    let calls = 0;
    const partly = new SupabaseProgramRepository(
      createClient("http://127.0.0.1:1", "unreachable", {
        global: {
          fetch: async () =>
            ++calls === 1
              ? new Response(JSON.stringify([{ id, name: "Other" }]), { status: 200, headers: { "content-type": "application/json" } })
              : new Response(JSON.stringify({ message: "boom" }), { status: 400, headers: { "content-type": "application/json" } }),
        },
      }) as unknown as Db,
    );
    await expect(partly.enrolledElsewhere(id, "coh_AAAAAAAAAAAA", [id])).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });

  it("throws when only the moving member's lookup fails during a move", async () => {
    let calls = 0;
    const partly = new SupabaseProgramRepository(
      createClient("http://127.0.0.1:1", "unreachable", {
        global: {
          fetch: async () => (++calls === 1 ? new Response("[]", { status: 200, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ message: "boom" }), { status: 400, headers: { "content-type": "application/json" } })),
        },
      }) as unknown as Db,
    );
    await expect(partly.moveEnrollments(id, id)).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });
});

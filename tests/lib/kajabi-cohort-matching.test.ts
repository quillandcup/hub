import { describe, it, expect } from "vitest";
import { resolveMatchDate, isDateWithinCohortWindow, computeCandidates } from "@/lib/kajabi-cohort-matching";

describe("resolveMatchDate", () => {
  it("prefers created_at_kajabi when present", () => {
    expect(
      resolveMatchDate({ created_at_kajabi: "2026-06-18T00:00:00Z", effective_start_at: "2025-01-01T00:00:00Z" })
    ).toBe("2026-06-18T00:00:00Z");
  });

  it("falls back to effective_start_at only when created_at_kajabi is null", () => {
    expect(resolveMatchDate({ created_at_kajabi: null, effective_start_at: "2025-01-01T00:00:00Z" })).toBe(
      "2025-01-01T00:00:00Z"
    );
  });

  it("returns null when neither date is present", () => {
    expect(resolveMatchDate({ created_at_kajabi: null, effective_start_at: null })).toBeNull();
    expect(resolveMatchDate({ created_at_kajabi: null })).toBeNull();
  });
});

describe("isDateWithinCohortWindow", () => {
  const cohort = { starts_at: "2026-06-14", expires_at: "2026-12-14" };

  it("is true for a date on starts_at", () => {
    expect(isDateWithinCohortWindow("2026-06-14T00:00:00Z", cohort)).toBe(true);
  });

  it("is true for a date on expires_at (inclusive)", () => {
    expect(isDateWithinCohortWindow("2026-12-14T23:59:59Z", cohort)).toBe(true);
  });

  it("is false for a date before starts_at", () => {
    expect(isDateWithinCohortWindow("2026-06-13T23:59:59Z", cohort)).toBe(false);
  });

  it("is false for a date the day after expires_at", () => {
    expect(isDateWithinCohortWindow("2026-12-15T00:00:00Z", cohort)).toBe(false);
  });
});

describe("resolveMatchDate + isDateWithinCohortWindow together (regression)", () => {
  // Reproduces the real bug: a repeat/alumna purchase whose real transaction
  // (created_at_kajabi) falls in the later cohort's window, but whose
  // effective_start_at is stale, reflecting original access from a much
  // earlier, unrelated cohort. Matching on either field independently (a
  // union of two ranges) incorrectly pulled this purchase into the earlier
  // cohort. Coalescing to created_at_kajabi first must NOT match the earlier
  // cohort here.
  const earlierCohort = { starts_at: "2025-09-08", expires_at: "2026-03-13" };
  const laterCohort = { starts_at: "2026-06-14", expires_at: "2026-12-14" };
  const purchase = {
    created_at_kajabi: "2026-06-18T14:00:00Z", // real transaction — in laterCohort's window
    effective_start_at: "2025-10-01T00:00:00Z", // stale, unrelated access date — in earlierCohort's window
  };

  it("does not match the earlier cohort whose window only contains the stale effective_start_at", () => {
    const matchDate = resolveMatchDate(purchase);
    expect(matchDate).toBe(purchase.created_at_kajabi);
    expect(isDateWithinCohortWindow(matchDate!, earlierCohort)).toBe(false);
  });

  it("matches the later cohort whose window contains the real transaction date", () => {
    const matchDate = resolveMatchDate(purchase);
    expect(isDateWithinCohortWindow(matchDate!, laterCohort)).toBe(true);
  });
});

describe("computeCandidates", () => {
  const offerNameById = new Map([["offer-180", "You did it once. Let's 180. Again!"]]);
  const kailey = { id: "member-kailey", name: "Kailey Haider", email: "kailey@example.com", status: "active" };
  const emailByCustomerId = new Map([["cust-kailey", "kailey@example.com"]]);
  const memberByEmail = new Map([["kailey@example.com", kailey]]);

  // Full end-to-end reproduction of the real production bug (not just the
  // two date helpers in isolation): Kailey's repeat purchase has a real
  // transaction date inside Cohort 4's window, but a stale effective_start_at
  // left over from earlier evergreen-course access, inside Cohort 2's
  // window. Calling the actual computeCandidates function (the same one
  // findKajabiCandidatesForCohort calls) must not surface her for Cohort 2.
  describe("stale effective_start_at from a repeat purchase (the real bug)", () => {
    const cohort2 = { id: "cohort-2", starts_at: "2025-09-08", expires_at: "2026-03-13" };
    const cohort4 = { id: "cohort-4", starts_at: "2026-06-14", expires_at: "2026-12-14" };
    const purchases = [
      {
        kajabi_customer_id: "cust-kailey",
        kajabi_offer_id: "offer-180",
        created_at_kajabi: "2026-06-18T14:00:00Z", // real transaction — Cohort 4's window
        effective_start_at: "2025-10-01T00:00:00Z", // stale — falls in Cohort 2's window
        deactivated_at: null,
      },
    ];

    it("does not surface her as a Cohort 2 candidate", () => {
      const candidates = computeCandidates(
        purchases,
        cohort2,
        offerNameById,
        emailByCustomerId,
        memberByEmail,
        new Map()
      );
      expect(candidates).toHaveLength(0);
    });

    it("surfaces her as a Cohort 4 candidate", () => {
      const candidates = computeCandidates(
        purchases,
        cohort4,
        offerNameById,
        emailByCustomerId,
        memberByEmail,
        new Map()
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0].member_id).toBe("member-kailey");
      expect(candidates[0].purchase_date).toBe("2026-06-18T14:00:00Z");
    });
  });

  // Two cohorts of the same program with genuinely overlapping windows: a
  // purchase can legitimately fall in both. Correct behavior — the candidate
  // shows up for both, annotated with already_enrolled_elsewhere for the one
  // that isn't their real cohort so staff can see the ambiguity rather than
  // it being silently hidden or silently double-enrolled.
  it("surfaces a candidate for an overlapping cohort with the already_enrolled_elsewhere annotation the caller supplies", () => {
    const overlapCohort = { id: "cohort-3", starts_at: "2026-01-18", expires_at: "2026-07-15" };
    const purchases = [
      {
        kajabi_customer_id: "cust-kailey",
        kajabi_offer_id: "offer-180",
        created_at_kajabi: "2026-06-18T14:00:00Z",
        effective_start_at: null,
        deactivated_at: null,
      },
    ];
    const alreadyElsewhereByMember = new Map([["member-kailey", "Cohort 4"]]);

    const candidates = computeCandidates(
      purchases,
      overlapCohort,
      offerNameById,
      emailByCustomerId,
      memberByEmail,
      alreadyElsewhereByMember
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].already_enrolled_elsewhere).toBe("Cohort 4");
  });

  it("groups multiple matching purchases for the same member into one candidate, keeping the earliest date and every distinct offer name", () => {
    const cohort = { id: "cohort-x", starts_at: "2026-01-01", expires_at: "2026-12-31" };
    const offerNames = new Map([
      ["offer-regular", "Q&C 180 Program"],
      ["offer-alumna", "You did it once. Let's 180. Again!"],
    ]);
    const purchases = [
      {
        kajabi_customer_id: "cust-kailey",
        kajabi_offer_id: "offer-alumna",
        created_at_kajabi: "2026-06-18T14:00:00Z",
        effective_start_at: null,
        deactivated_at: null,
      },
      {
        kajabi_customer_id: "cust-kailey",
        kajabi_offer_id: "offer-regular",
        created_at_kajabi: "2026-02-01T09:00:00Z",
        effective_start_at: null,
        deactivated_at: null,
      },
    ];

    const candidates = computeCandidates(purchases, cohort, offerNames, emailByCustomerId, memberByEmail, new Map());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].purchase_date).toBe("2026-02-01T09:00:00Z"); // earliest of the two
    expect(candidates[0].offer_names.sort()).toEqual(["Q&C 180 Program", "You did it once. Let's 180. Again!"].sort());
  });

  it("skips a purchase whose customer doesn't resolve to any known member", () => {
    const cohort = { id: "cohort-x", starts_at: "2026-01-01", expires_at: "2026-12-31" };
    const purchases = [
      {
        kajabi_customer_id: "cust-unknown",
        kajabi_offer_id: "offer-180",
        created_at_kajabi: "2026-06-18T14:00:00Z",
        effective_start_at: null,
        deactivated_at: null,
      },
    ];
    const candidates = computeCandidates(
      purchases,
      cohort,
      offerNameById,
      emailByCustomerId,
      memberByEmail,
      new Map()
    );
    expect(candidates).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { HANDOVER_REFUSAL_MESSAGES, handoverControls } from "@/lib/care-handover";
import { HANDOVER_REFUSALS } from "@/lib/data/care";

const OWNER = "11111111-1111-4111-8111-111111111111";
const RECEIVER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const plan = { owned_by: OWNER, handover_to: null, handover_by: null, closed_at: null };
const offered = { owned_by: OWNER, handover_to: RECEIVER, handover_by: OWNER, closed_at: null };

describe("handoverControls: what a staff member may do with a care plan's hand-over", () => {
  it("lets the owner and an admin offer a plan nothing is pending on, and no one else", () => {
    expect(handoverControls(plan, { userId: OWNER, isAdmin: false }).canPropose).toBe(true);
    expect(handoverControls(plan, { userId: ADMIN, isAdmin: true }).canPropose).toBe(true);
    expect(handoverControls(plan, { userId: OTHER, isAdmin: false }).canPropose).toBe(false);
  });

  it("offers nothing while an offer waits (one per plan), and says it is pending", () => {
    expect(handoverControls(offered, { userId: OWNER, isAdmin: false })).toMatchObject({ pending: true, canPropose: false });
    expect(handoverControls(plan, { userId: OWNER, isAdmin: false }).pending).toBe(false);
  });

  it("lets the receiver answer it, and only the receiver", () => {
    expect(handoverControls(offered, { userId: RECEIVER, isAdmin: false }).offeredToMe).toBe(true);
    expect(handoverControls(offered, { userId: OWNER, isAdmin: false }).offeredToMe).toBe(false);
    expect(handoverControls(plan, { userId: RECEIVER, isAdmin: false }).offeredToMe).toBe(false);
  });

  it("lets whoever offered it, the owner or an admin take it back, and not the receiver or a bystander", () => {
    expect(handoverControls({ ...offered, handover_by: ADMIN }, { userId: ADMIN, isAdmin: false }).canCancel).toBe(true); // who offered it
    expect(handoverControls({ ...offered, handover_by: ADMIN }, { userId: OWNER, isAdmin: false }).canCancel).toBe(true); // the owner
    expect(handoverControls(offered, { userId: ADMIN, isAdmin: true }).canCancel).toBe(true); // an admin
    expect(handoverControls(offered, { userId: RECEIVER, isAdmin: false }).canCancel).toBe(false);
    expect(handoverControls(offered, { userId: OTHER, isAdmin: false }).canCancel).toBe(false);
    expect(handoverControls(plan, { userId: OWNER, isAdmin: false }).canCancel).toBe(false); // nothing to take back
  });

  it("lets anyone claim a plan with no owner, and no one claim one that has an owner", () => {
    expect(handoverControls({ ...plan, owned_by: null }, { userId: OTHER, isAdmin: false }).canClaim).toBe(true);
    expect(handoverControls(plan, { userId: OTHER, isAdmin: false }).canClaim).toBe(false);
    // Offering one nobody owns is for admins (the owner is nobody).
    expect(handoverControls({ ...plan, owned_by: null }, { userId: OTHER, isAdmin: false }).canPropose).toBe(false);
    expect(handoverControls({ ...plan, owned_by: null }, { userId: ADMIN, isAdmin: true }).canPropose).toBe(true);
  });
});

describe("handoverControls: taking a plan over", () => {
  it("lets an admin take an open plan from its owner, with or without an offer pending", () => {
    expect(handoverControls(plan, { userId: ADMIN, isAdmin: true }).canTakeOver).toBe(true);
    expect(handoverControls(offered, { userId: ADMIN, isAdmin: true }).canTakeOver).toBe(true);
  });

  it("offers it to no one else: a community manager needs the receiver's agreement, and the owner already has the plan", () => {
    expect(handoverControls(plan, { userId: OTHER, isAdmin: false }).canTakeOver).toBe(false);
    expect(handoverControls(offered, { userId: RECEIVER, isAdmin: false }).canTakeOver).toBe(false);
    expect(handoverControls(plan, { userId: OWNER, isAdmin: false }).canTakeOver).toBe(false);
  });

  it("is not offered to an admin for a plan that is already theirs, a closed one (it keeps its owner) or one nobody owns (that is Take this care plan)", () => {
    expect(handoverControls({ ...plan, owned_by: ADMIN }, { userId: ADMIN, isAdmin: true }).canTakeOver).toBe(false);
    expect(handoverControls({ ...plan, closed_at: "2027-01-01T00:00:00Z" }, { userId: ADMIN, isAdmin: true }).canTakeOver).toBe(false);
    expect(handoverControls({ ...plan, owned_by: null }, { userId: ADMIN, isAdmin: true })).toMatchObject({ canTakeOver: false, canClaim: true });
  });
});

describe("HANDOVER_REFUSAL_MESSAGES", () => {
  it("has a plain sentence for every refusal the database can make, with no ids in it", () => {
    for (const reason of HANDOVER_REFUSALS) {
      expect(HANDOVER_REFUSAL_MESSAGES[reason]).toMatch(/^[A-Z].*\.$/);
      expect(HANDOVER_REFUSAL_MESSAGES[reason]).not.toMatch(/care_|care_handover|[0-9a-f]{8}-/);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  ACK_NOTE_MAX,
  ACK_REASONS,
  ACK_REASON_HINTS,
  ACK_REASON_LABELS,
  ACK_REASON_PHRASES,
  ackInputError,
  ackStillApplies,
  ackViewFor,
  activeByKey,
  changedSinceText,
  cleanNote,
  isAcknowledged,
  type AckRecord,
} from "@/lib/billing-acknowledgements";

const record = (extra: Partial<AckRecord> = {}): AckRecord => ({
  rowKey: "mbr_AAAAAAAAAAA1:event:evt:p1:1",
  memberId: "mbr_AAAAAAAAAAA1",
  purchaseType: "event",
  reason: "comp",
  note: "Seed launch",
  statusAtAck: "missing_payment",
  amountCentsAtAck: 69700,
  acknowledgedBy: "user-1",
  acknowledgedAt: "2026-11-27T15:00:00Z",
  revokedBy: null,
  revokedAt: null,
  ...extra,
});
const subject = (status = "missing_payment", amountCents: number | null = 69700) => ({ key: "mbr_AAAAAAAAAAA1:event:evt:p1:1", status, amountCents });

describe("the reasons", () => {
  it("are the fixed set, each with a label, a hint and a phrase for the Activity Log", () => {
    expect([...ACK_REASONS]).toEqual(["gift", "comp", "forfeited", "paid_elsewhere", "other"]);
    for (const reason of ACK_REASONS) {
      expect(ACK_REASON_LABELS[reason]).toBeTruthy();
      expect(ACK_REASON_HINTS[reason]).toBeTruthy();
      expect(ACK_REASON_PHRASES[reason]).toBeTruthy();
    }
  });
});

describe("checking what staff typed", () => {
  it("wants a reason from the set", () => {
    expect(ackInputError("comp", null)).toBeNull();
    expect(ackInputError("because", null)).toBe("Choose a reason.");
    expect(ackInputError(undefined, null)).toBe("Choose a reason.");
  });

  it("requires a note for other only, and caps its length", () => {
    expect(ackInputError("other", null)).toBe("Add a note saying what this is.");
    expect(ackInputError("other", "A cash payment at the retreat")).toBeNull();
    expect(ackInputError("gift", "x".repeat(ACK_NOTE_MAX))).toBeNull();
    expect(ackInputError("gift", "x".repeat(ACK_NOTE_MAX + 1))).toMatch(/500 characters/);
  });

  it("trims the note and turns a blank one into none", () => {
    expect(cleanNote("  a note  ")).toBe("a note");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });
});

describe("whether an acknowledgement still applies", () => {
  it("applies while the status and the amount at stake are what staff saw", () => {
    expect(ackStillApplies(subject(), record())).toBe(true);
  });

  it("stops applying when the status changes (a payment arrived, or it became another kind of problem)", () => {
    expect(ackStillApplies(subject("unexplained_payment"), record())).toBe(false);
  });

  it("stops applying when the amount changes, in either direction", () => {
    expect(ackStillApplies(subject("missing_payment", 99700), record())).toBe(false);
    expect(ackStillApplies(subject("missing_payment", 100), record())).toBe(false);
    expect(ackStillApplies(subject("missing_payment", null), record())).toBe(false);
  });

  it("treats no amount then and no amount now as the same", () => {
    expect(ackStillApplies(subject("hub_stripe_disagree", null), record({ statusAtAck: "hub_stripe_disagree", amountCentsAtAck: null }))).toBe(true);
  });
});

describe("the view of an acknowledgement", () => {
  it("has none for a row never marked or one that was revoked", () => {
    expect(ackViewFor(subject(), undefined)).toBeNull();
    expect(ackViewFor(subject(), record({ revokedAt: "2026-11-28T00:00:00Z", revokedBy: "user-2" }))).toBeNull();
  });

  it("names who marked it and the Eastern day, whatever the hour in UTC", () => {
    const staff = new Map([["user-1", "dana@example.test"]]);
    // 01:30 UTC on the 28th is still the evening of the 27th in New York.
    expect(ackViewFor(subject(), record({ acknowledgedAt: "2026-11-28T01:30:00Z" }), staff)).toMatchObject({ by: "dana@example.test", day: "2026-11-27", state: "applies", reason: "comp", note: "Seed launch" });
    expect(ackViewFor(subject(), record({ acknowledgedAt: "2026-11-28T06:30:00Z" }), staff)?.day).toBe("2026-11-28");
    expect(ackViewFor(subject(), record())?.by).toBeNull();
  });

  it("is changed, not applying, once the row differs, and says so in words", () => {
    const view = ackViewFor(subject("paid"), record());
    expect(view?.state).toBe("changed");
    expect(isAcknowledged(view)).toBe(false);
    expect(isAcknowledged(ackViewFor(subject(), record()))).toBe(true);
    expect(isAcknowledged(null)).toBe(false);
    expect(changedSinceText({ reason: "comp", day: "2026-11-27" })).toBe("Was marked complimentary on 2026-11-27, but it has changed since.");
  });
});

describe("the active acknowledgements", () => {
  it("are keyed by row and leave the revoked ones out", () => {
    const active = activeByKey([record(), record({ rowKey: "other", revokedAt: "2026-11-28T00:00:00Z", revokedBy: "user-2" })]);
    expect([...active.keys()]).toEqual(["mbr_AAAAAAAAAAA1:event:evt:p1:1"]);
  });
});

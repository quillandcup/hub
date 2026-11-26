import { describe, expect, it } from "vitest";
import { loadAcknowledgements } from "@/lib/billing-acknowledgements-loader";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const MEMBER = "mbr_AAAAAAAAAAA1";
const ack = (id: string, key: string, extra: Record<string, unknown> = {}) => ({
  id,
  row_key: key,
  member_id: MEMBER,
  purchase_type: "membership",
  reason: "gift",
  note: null,
  status_at_ack: "missed",
  amount_cents_at_ack: 4700,
  acknowledged_by: "user-1",
  acknowledged_at: "2026-05-30T16:00:00Z",
  revoked_by: null,
  revoked_at: null,
  ...extra,
});

describe("loadAcknowledgements", () => {
  it("reads nothing when there are none, without looking anyone up", async () => {
    const repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: MEMBER, name: "Ada Example" }] } as never));
    const { acks, staff } = await loadAcknowledgements(repos);
    expect(acks.size).toBe(0);
    expect(staff.size).toBe(0);
  });

  it("returns the active ones by row key with the sign-in email of whoever made them, and leaves out the revoked", async () => {
    const repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [{ id: MEMBER, name: "Ada Example" }],
        userProfiles: [
          { id: "user-1", email: "dana@example.test" },
          { id: "user-2", email: "eve@example.test" },
        ],
        billingAcknowledgements: [
          ack("brak_AAAAAAAAAAA1", `${MEMBER}:membership:2026-03`),
          ack("brak_AAAAAAAAAAA2", `${MEMBER}:membership:2026-04`, { acknowledged_by: null }),
          ack("brak_AAAAAAAAAAA3", `${MEMBER}:membership:2026-05`, { acknowledged_by: "user-2", revoked_by: "user-1", revoked_at: "2026-05-31T00:00:00Z" }),
        ],
      } as never)
    );
    const { acks, staff } = await loadAcknowledgements(repos);
    expect([...acks.keys()]).toEqual([`${MEMBER}:membership:2026-03`, `${MEMBER}:membership:2026-04`]);
    expect(acks.get(`${MEMBER}:membership:2026-03`)).toMatchObject({ reason: "gift", acknowledgedBy: "user-1" });
    expect([...staff]).toEqual([["user-1", "dana@example.test"]]);
  });
});

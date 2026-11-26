import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseBillingAcknowledgementRepository } from "@/lib/data/billing-acknowledgements";
import { defineBillingAcknowledgementContract } from "@/tests/helpers/billing-acknowledgement-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const admin = getTestSupabaseAdminClient();
const RUN = `${Date.now()}`;
let members: [string, string];
let staff: string;
let counter = 0;

beforeAll(async () => {
  const people = await db
    .from("members")
    .insert(["ada", "bea"].map((n) => ({ name: `Ack ${n} ${RUN}`, email: `${RUN}-ack-${n}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (people.error) throw new Error(people.error.message);
  const byName = (n: string) => people.data.find((p) => p.email === `${RUN}-ack-${n}@example.com`)!.id;
  members = [byName("ada"), byName("bea")];
  const user = await admin.auth.admin.createUser({ email: `${RUN}-ack-staff@example.com`, email_confirm: true });
  if (user.error || !user.data.user) throw new Error(user.error?.message ?? "no user");
  staff = user.data.user.id;
});

// Nothing deletes an acknowledgement, so the members go (their rows with them), then the account.
afterAll(async () => {
  await db.from("members").delete().in("id", members ?? []);
  if (staff) await admin.auth.admin.deleteUser(staff);
});

defineBillingAcknowledgementContract("SupabaseBillingAcknowledgementRepository", () => ({
  repo: () => new SupabaseBillingAcknowledgementRepository(db),
  get members() {
    return members;
  },
  get staff() {
    return staff;
  },
  keyPrefix: `${members?.[0] ?? "run"}-${++counter}`,
}));

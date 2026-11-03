import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseResendEventRepository } from "@/lib/data/resend";
import { defineResendEventContract } from "@/tests/helpers/resend-event-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `resendtest${Date.now()}`;
let counter = 0;

const clear = async () => {
  const { error } = await db.schema("bronze").from("resend_events").delete().like("email_id", `%${RUN}%`);
  if (error) throw new Error(error.message);
};

afterAll(clear);

defineResendEventContract("SupabaseResendEventRepository", () => ({
  repo: () => new SupabaseResendEventRepository(db),
  unique: (label) => `${label}-${RUN}-${++counter}`,
  clear,
}));

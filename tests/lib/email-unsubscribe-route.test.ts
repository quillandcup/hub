import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";
import { signUnsubscribeToken } from "@/lib/email-unsubscribe";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => fake }));

const route = await import("@/app/api/email/unsubscribe/route");

const MEMBER = "11111111-1111-4111-8111-111111111111";
const post = (token: string | null) =>
  route.POST(
    new NextRequest(`http://localhost/api/email/unsubscribe${token ? `?t=${token}` : ""}`, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })
  );
const upserts = () => fake.queries.flatMap((q) => q.calls.filter((c) => c.method === "upsert"));

beforeEach(() => {
  fake = createFakeSupabase();
});

describe("POST /api/email/unsubscribe", () => {
  it("turns off that kind's emails for the member in the token", async () => {
    const response = await post(signUnsubscribeToken(MEMBER, "prickle_checkout"));

    expect(response.status).toBe(200);
    expect(upserts().map((c) => c.args[0])).toEqual([
      { member_id: MEMBER, kind: "prickle_checkout", channel: "email", enabled: false },
    ]);
  });

  it("changes nothing for a missing or forged token", async () => {
    expect((await post(null)).status).toBe(400);
    expect((await post(`${MEMBER}.prickle_checkout.forged`)).status).toBe(400);
    expect(upserts()).toEqual([]);
  });

  it("answers 500 when the choice can't be saved, so the mail client can retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = createFakeSupabase({ notification_preferences: { error: { message: "boom" } } });

    expect((await post(signUnsubscribeToken(MEMBER, "prickle_checkout"))).status).toBe(500);
  });

  it("has no GET handler: link scanners opening the URL must not unsubscribe anyone", () => {
    expect("GET" in route).toBe(false);
  });
});

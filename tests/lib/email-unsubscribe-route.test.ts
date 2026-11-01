import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { signUnsubscribeToken } from "@/lib/email-unsubscribe";

// The choice is stored through the notification repository, in memory here.
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

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

beforeEach(() => {
  repos = createInMemoryRepos(new InMemoryDataset());
});

describe("POST /api/email/unsubscribe", () => {
  it("turns off that kind's emails for the member in the token", async () => {
    const response = await post(signUnsubscribeToken(MEMBER, "prickle_checkout"));

    expect(response.status).toBe(200);
    expect(await repos.notifications.preferencesOf(MEMBER)).toEqual([
      { memberId: MEMBER, kind: "prickle_checkout", channel: "email", enabled: false },
    ]);
  });

  it("changes nothing for a missing or forged token", async () => {
    expect((await post(null)).status).toBe(400);
    expect((await post(`${MEMBER}.prickle_checkout.forged`)).status).toBe(400);
    expect(await repos.notifications.preferencesOf(MEMBER)).toEqual([]);
  });

  it("answers 500 when the choice can't be saved, so the mail client can retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repos.notifications.setPreference = async () => {
      throw new Error("boom");
    };

    expect((await post(signUnsubscribeToken(MEMBER, "prickle_checkout"))).status).toBe(500);
  });

  it("has no GET handler: link scanners opening the URL must not unsubscribe anyone", () => {
    expect("GET" in route).toBe(false);
  });
});

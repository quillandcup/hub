import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// Feedback, its senders and their profiles come from the repositories, in memory here; the route
// only uses the client for screenshot links (none of these rows has one).
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

let signedIn = true;
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (signedIn ? { user: { id: "admin" }, forbidden: false, supabase: {} } : { user: null }),
}));

import { GET } from "@/app/api/admin/feedback/route";

const ADA = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const call = () => GET(new NextRequest("http://localhost/api/admin/feedback"));
const feedback = (id: string, over: { user_id: string | null; member_id: string | null; created_at: string }) => ({
  id,
  admin_notes: null,
  feedback_type: "bug",
  is_sudo: false,
  message: `message ${id}`,
  page_url: "/dashboard",
  screenshot_path: null,
  status: "new",
  user_agent: null,
  ...over,
});

beforeEach(() => {
  signedIn = true;
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: ADA, name: "Zed Legal", displayName: "Ada E", email: "ada@example.test" },
        { id: BEA, name: "Bea Plain", email: "bea@example.test" },
      ],
      feedback: [
        feedback("f1", { user_id: "u1", member_id: ADA, created_at: "2026-10-03T00:00:00Z" }),
        feedback("f2", { user_id: "u2", member_id: BEA, created_at: "2026-10-02T00:00:00Z" }),
        feedback("f3", { user_id: null, member_id: null, created_at: "2026-10-01T00:00:00Z" }),
      ],
      userProfiles: [{ id: "u1", email: "ada@example.test" }],
    })
  );
});

describe("GET /api/admin/feedback", () => {
  it("is for signed-in admins", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
  });

  it("passes the submitter's display name beside the legal name through", async () => {
    const { items } = await (await call()).json();

    expect(items.map((i: { id: string }) => i.id)).toEqual(["f1", "f2", "f3"]);
    expect(items[0].member).toMatchObject({ name: "Zed Legal", display_name: "Ada E" });
    expect(items[1].member).toMatchObject({ name: "Bea Plain", display_name: null });
    expect(items[0].submitter_email).toBe("ada@example.test");
  });

  it("lists feedback from a removed member, who has no user any more, without a submitter", async () => {
    const { items } = await (await call()).json();
    expect(items.find((i: { id: string }) => i.id === "f3")).toMatchObject({ user_id: null, submitter_email: null });
  });

  it("answers 500 when the feedback can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    repos.adminWork.feedbackPage = async () => {
      throw new Error("database is down");
    };

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to load feedback" });
  });
});

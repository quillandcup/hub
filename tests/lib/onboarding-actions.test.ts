import { describe, it, expect, vi, beforeEach } from "vitest";

// The actions write only the signed-in member's own member_onboarding row and rely on RLS
// (member or admin; see supabase/tests/database/member_onboarding.test.sql). These tests cover the
// app-level sudo refusal, step validation, and what gets written.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  completeOnboarding,
  dismissOnboarding,
  markOnboardingStep,
  startOnboarding,
} from "@/app/actions/onboarding";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

const USER = { id: "user-1", email: "m1@example.com" };
const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };

function makeSupabase({ existing = null as unknown, error = null as unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing });
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));
  const from = vi.fn(() => ({ upsert, select }));
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, upsert };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(USER as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY as never);
});

describe("onboarding actions", () => {
  it("startOnboarding resets the member's row so the tour shows from the first undone step", async () => {
    const sb = makeSupabase();
    expect(await startOnboarding()).toEqual({ success: true });
    expect(sb.from).toHaveBeenCalledWith("member_onboarding");
    expect(sb.upsert).toHaveBeenCalledWith(
      { member_id: "member-1", marked_steps: [], dismissed_at: null, completed_at: null, updated_at: expect.any(String) },
      { onConflict: "member_id" }
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("dismissOnboarding and completeOnboarding stamp their timestamp", async () => {
    const sb = makeSupabase();
    await dismissOnboarding();
    expect(sb.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ member_id: "member-1", dismissed_at: expect.any(String) }),
      { onConflict: "member_id" }
    );
    await completeOnboarding();
    expect(sb.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ member_id: "member-1", completed_at: expect.any(String) }),
      { onConflict: "member_id" }
    );
  });

  it("markOnboardingStep adds the step to those already marked, once", async () => {
    const sb = makeSupabase({ existing: { marked_steps: ["identity"] } });
    expect(await markOnboardingStep("profile")).toEqual({ success: true });
    expect(sb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ marked_steps: ["identity", "profile"] }),
      { onConflict: "member_id" }
    );

    await markOnboardingStep("identity");
    expect(sb.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ marked_steps: ["identity"] }),
      { onConflict: "member_id" }
    );
  });

  it("markOnboardingStep rejects an unknown step without writing", async () => {
    const sb = makeSupabase();
    expect(await markOnboardingStep("nope")).toEqual({ error: "Unknown step" });
    expect(sb.upsert).not.toHaveBeenCalled();
  });

  it("refuses during sudo, so an admin can't change a member's tour", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, isSudo: true } as never);
    const sb = makeSupabase();
    for (const action of [startOnboarding, dismissOnboarding, completeOnboarding, () => markOnboardingStep("identity")]) {
      expect(await action()).toHaveProperty("error");
    }
    expect(sb.upsert).not.toHaveBeenCalled();
  });

  it("reports a failed write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    makeSupabase({ error: { message: "boom" } });
    expect(await dismissOnboarding()).toEqual({ error: expect.any(String) });
  });
});

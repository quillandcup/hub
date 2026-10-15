// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage } from "@/tests/helpers/server-page";
const admin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: admin }));
vi.mock("@/app/(admin)/admin/mentorship/MentorshipPage", () => ({ default: ({ tab, prefill }: { tab: string; prefill?: { newMemberId?: string } }) => <div data-testid="panel" data-tab={tab} data-member={prefill?.newMemberId} /> }));
import MatchesPage from "@/app/(admin)/admin/mentorship/page";
import VolunteersPage from "@/app/(admin)/admin/mentorship/volunteers/page";
import EffectivenessPage from "@/app/(admin)/admin/mentorship/big-sisters/page";
beforeEach(() => { admin.mockReset(); admin.mockResolvedValue(undefined); });
describe("Big Sister tab routes", () => {
  it.each(["member-id", ["first-member", "second-member"], undefined])("passes the first Work Queue member parameter to the matching form (%s)", async value => {
    await renderServerPage(MatchesPage, { searchParams: Promise.resolve({ new: value }) });
    expect(admin).toHaveBeenCalledOnce(); expect(screen.getByTestId("panel")).toHaveAttribute("data-tab", "matches");
    if (value) expect(screen.getByTestId("panel")).toHaveAttribute("data-member", Array.isArray(value) ? value[0] : value);
    else expect(screen.getByTestId("panel")).not.toHaveAttribute("data-member");
  });
  it.each([[VolunteersPage, "volunteers"], [EffectivenessPage, "big-sisters"]] as const)("authorizes and selects the %s tab", async (Page, tab) => {
    await renderServerPage(Page, {}); expect(admin).toHaveBeenCalledOnce(); expect(screen.getByTestId("panel")).toHaveAttribute("data-tab", tab);
  });
  it("stops at authorization before rendering a protected tab", async () => {
    admin.mockRejectedValue(new Error("Forbidden")); await expect(VolunteersPage()).rejects.toThrow("Forbidden");
  });
});

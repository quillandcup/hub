// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectRedirect, resetServerPageMocks } from "@/tests/helpers/server-page";
import { requireAdminPage } from "@/lib/admin-auth";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));

import SegmentsPage from "@/app/(admin)/admin/segments/page";

beforeEach(() => resetServerPageMocks());

describe("old segments page", () => {
  it("checks for an admin, then sends the visitor to Previews", async () => {
    await expectRedirect(async () => (await SegmentsPage(), null), {}, "/admin/previews");
    expect(requireAdminPage).toHaveBeenCalled();
  });
});

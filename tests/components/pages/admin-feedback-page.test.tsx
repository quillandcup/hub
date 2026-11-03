// @vitest-environment jsdom
/** The admin feedback page: a member id in ?member= narrows it to that member's feedback; anything else shows everyone's. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: async () => undefined }));
const client = vi.hoisted(() => vi.fn((_props: { memberId?: string }) => null));
vi.mock("@/app/(admin)/admin/feedback/FeedbackClient", () => ({ default: (props: { memberId?: string }) => client(props) }));

import FeedbackPage from "@/app/(admin)/admin/feedback/page";

beforeEach(() => {
  cleanup();
  resetServerPageMocks();
  client.mockClear();
  signInAs({ id: "u1", email: "admin@example.test" }, null);
});

describe("/admin/feedback", () => {
  it("passes a member id to the list", async () => {
    await renderServerPage(FeedbackPage, { searchParams: Promise.resolve({ member: "mbr_AAAAAAAAAAA1" }) });
    expect(client).toHaveBeenCalledWith({ memberId: "mbr_AAAAAAAAAAA1" });
  });

  it("shows everyone's feedback with no member, or one that is not a member id", async () => {
    await renderServerPage(FeedbackPage, { searchParams: Promise.resolve({}) });
    await renderServerPage(FeedbackPage, { searchParams: Promise.resolve({ member: "not-an-id" }) });
    expect(client.mock.calls.map(([props]) => props)).toEqual([{ memberId: undefined }, { memberId: undefined }]);
  });
});

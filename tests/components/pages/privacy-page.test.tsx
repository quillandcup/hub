// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  MEMBER_IDENTITY,
  MEMBER_USER,
  expectRedirect,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
} from "@/tests/helpers/server-page";
import type { FeatureKey } from "@/lib/features";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));

const getUserFeaturePreviews = vi.fn<(userId: string) => Promise<FeatureKey[]>>();
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => getUserFeaturePreviews(id) }));

import PrivacyPage from "@/app/(member)/privacy/page";

describe("/privacy (message_privacy flag)", () => {
  beforeEach(() => {
    resetServerPageMocks();
    getUserFeaturePreviews.mockReset();
  });

  it("redirects anonymous visitors to /login", async () => {
    signInAs(null);
    await expectRedirect(PrivacyPage, {}, "/login");
  });

  it("redirects members without the flag to /dashboard", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue([]);
    await expectRedirect(PrivacyPage, {}, "/dashboard");
  });

  it("renders the content/activity breakdown with the flag on", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    getUserFeaturePreviews.mockResolvedValue(["message_privacy"]);
    await renderServerPage(PrivacyPage, {});
    expect(screen.getByRole("heading", { name: "Message Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Break-glass access" })).toBeInTheDocument();
    expect(screen.getByText("Direct messages and group DMs in the Hub")).toBeInTheDocument();
  });
});

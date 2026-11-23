// @vitest-environment jsdom
/**
 * Where a landing page's address is shown while the public site is NOT live (config/app.ts `publicSiteLive` false, until the
 * cutover): /p/<slug> on the Hub host, as it always was. The bare address is the live state (landing-admin.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { LandingPageSummary } from "@/lib/data/landing-pages";
import { APP_URL } from "@/lib/config";
import { landingAddressPrefix, landingPagePath, landingPageUrl } from "@/lib/landing/address";

vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.notLiveConfigModule()));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/media/MediaPicker", () => ({ default: () => <div>picker</div> }));
vi.mock("../../src/app/(admin)/admin/pages/actions", () => ({ duplicateLandingPage: vi.fn(), deleteLandingPage: vi.fn(), createLandingPage: vi.fn(), createLandingPageWithAi: vi.fn() }));

import PagesTable from "@/app/(admin)/admin/pages/PagesTable";
import NewPageForm from "@/app/(admin)/admin/pages/new/NewPageForm";

const row = (over: Partial<LandingPageSummary>): LandingPageSummary => ({
  id: "lpg_AAAAAAAAAAA1",
  slug: "waitlist",
  title: "Waitlist",
  kind: "page",
  page_type: "landing",
  status: "published",
  seo_title: null,
  seo_description: null,
  social_image_asset_id: null,
  first_published_at: null,
  published_at: null,
  restored_from_version_id: null,
  restored_at: null,
  import_key: null,
  imported_at: null,
  replaced_at: null,
  created_by: null,
  updated_by: null,
  created_at: "2027-01-01T00:00:00Z",
  updated_at: "2027-01-02T00:00:00Z",
  deleted_at: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("a landing page's address, in the state before the cutover", () => {
  it("is /p/<slug> on the Hub host, `home` included", () => {
    expect(landingPagePath("spring")).toBe("/p/spring");
    expect(landingPagePath("home")).toBe("/p/home");
    expect(landingPageUrl("spring")).toBe(`${APP_URL}/p/spring`);
    expect(landingAddressPrefix()).toBe(`${new URL(APP_URL).host}/p/`);
  });

  it("is the bare address on the root host in the other state, for the same function", () => {
    expect(landingPagePath("spring", true)).toBe("/spring");
    expect(landingPagePath("home", true)).toBe("/");
    expect(landingPageUrl("spring", true, "https://root.example")).toBe("https://root.example/spring");
    expect(landingAddressPrefix(true, "https://root.example")).toBe("root.example/");
  });

  it("shows /p/<slug> in the Pages list and copies the Hub host's link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PagesTable pages={[row({})]} publicBase={APP_URL} />);
    expect(screen.getByText("/p/waitlist")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith(`${APP_URL}/p/waitlist`);
  });

  it("shows the Hub host's /p/ address before the field in the new page form", () => {
    render(<NewPageForm aiAvailable={false} />);
    expect(screen.getByText(`${new URL(APP_URL).host}/p/`)).toBeInTheDocument();
  });
});

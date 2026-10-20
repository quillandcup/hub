// @vitest-environment jsdom
/** The user menu button shows who is signed in (a member's name, an admin's email); usage tracking must never record it. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/SudoModal", () => ({ default: () => null }));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign out</button> }));
vi.mock("@/app/actions/onboarding", () => ({ startOnboarding: vi.fn() }));

import UserMenu from "@/components/UserMenu";
import { flush, setTrackingEnabled } from "@/lib/analytics/client";
import { startAutocapture } from "@/lib/analytics/autocapture";

afterEach(() => {
  setTrackingEnabled(false);
  vi.unstubAllGlobals();
});

describe.each(["Fern Quillsby", "cody@example.test"])("UserMenu shown as %s", (who) => {
  it("is tracked as a click on the user menu, without the name or email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setTrackingEnabled(true);
    const stop = startAutocapture();

    render(<UserMenu userEmail={who} />);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(who) }));
    await flush();
    stop();

    const body = fetchMock.mock.calls[0][1].body as string;
    expect(JSON.parse(body).events[0].properties).toMatchObject({ element: "button", name: "user-menu" });
    expect(JSON.parse(body).events[0].properties).not.toHaveProperty("text");
    expect(body).not.toContain(who);
  });
});

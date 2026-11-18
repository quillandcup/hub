// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  unenroll: vi.fn(),
}));
const refreshSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { mfa, refreshSession } }) }));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign Out</button> }));

import { APP_NAME } from "@/lib/config";
import MfaPanel from "@/components/mfa/MfaPanel";
import MfaChallengeForm from "@/components/mfa/MfaChallengeForm";

const FACTOR = { id: "factor-1", friendly_name: "Authenticator app", created_at: "2026-11-18T10:00:00.000Z", factor_type: "totp", status: "verified" };
const SECRET = "JBSWY3DPEHPK3PXP";

function none() {
  mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
}
function enrolled() {
  mfa.listFactors.mockResolvedValue({ data: { all: [FACTOR], totp: [FACTOR] }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  mfa.enroll.mockResolvedValue({ data: { id: "factor-new", totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: SECRET, uri: "otpauth://x" } }, error: null });
  mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  mfa.unenroll.mockResolvedValue({ data: {}, error: null });
  refreshSession.mockResolvedValue({});
});

describe("MfaPanel", () => {
  it("offers to set it up when there is no factor", async () => {
    none();
    render(<MfaPanel />);
    expect(await screen.findByRole("button", { name: "Set up two-step sign-in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("shows the QR code and the key as text, then turns it on with a code", async () => {
    none();
    const user = userEvent.setup();
    render(<MfaPanel />);

    await user.click(await screen.findByRole("button", { name: "Set up two-step sign-in" }));
    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
    expect(screen.getByTestId("mfa-secret")).toHaveTextContent(SECRET);
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Authenticator app", issuer: APP_NAME });

    const turnOn = screen.getByRole("button", { name: "Turn on" });
    expect(turnOn).toBeDisabled();
    await user.type(screen.getByLabelText(/6-digit code/), "123 456");
    enrolled();
    await user.click(turnOn);

    await waitFor(() => expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-new", code: "123456" }));
    expect(await screen.findByText(/Two-step sign-in is on/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("clears a set-up that was started and never finished before starting a new one", async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [{ id: "stale", factor_type: "totp", status: "unverified" }], totp: [] }, error: null });
    const user = userEvent.setup();
    render(<MfaPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up two-step sign-in" }));
    await screen.findByAltText(/QR code/);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "stale" });
  });

  it("says so when the code is wrong, and stays on the set-up", async () => {
    none();
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: new Error("invalid") });
    const user = userEvent.setup();
    render(<MfaPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up two-step sign-in" }));
    await user.type(await screen.findByLabelText(/6-digit code/), "000000");
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText(/That code didn't work/)).toBeInTheDocument();
    expect(screen.getByTestId("mfa-secret")).toBeInTheDocument();
  });

  it("cancelling a set-up removes the half-made factor", async () => {
    none();
    const user = userEvent.setup();
    render(<MfaPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up two-step sign-in" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-new" });
    expect(await screen.findByRole("button", { name: "Set up two-step sign-in" })).toBeInTheDocument();
  });

  it("reports when it can't start", async () => {
    none();
    mfa.enroll.mockResolvedValue({ data: null, error: new Error("nope") });
    const user = userEvent.setup();
    render(<MfaPanel />);
    await user.click(await screen.findByRole("button", { name: "Set up two-step sign-in" }));
    expect(await screen.findByText(/couldn't start the set-up/)).toBeInTheDocument();
  });

  it("lists the enrolled factor and removes it only after a confirmation dialog", async () => {
    enrolled();
    const user = userEvent.setup();
    render(<MfaPanel />);

    expect(await screen.findByText("Authenticator app")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(mfa.unenroll).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Remove two-step sign-in?");

    none();
    await user.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    await waitFor(() => expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "factor-1" }));
    expect(refreshSession).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Set up two-step sign-in" })).toBeInTheDocument();
  });

  it("keeps the confirmation open with the reason when removing fails", async () => {
    enrolled();
    mfa.unenroll.mockResolvedValue({ data: null, error: new Error("needs aal2") });
    const user = userEvent.setup();
    render(<MfaPanel />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    expect(await screen.findByText(/couldn't remove it/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("warns staff that they will be asked to set it up again", async () => {
    enrolled();
    const user = userEvent.setup();
    render(<MfaPanel staff />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/Staff accounts need two-step sign-in/);
  });

  it("tells the member when it can't read their factors", async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: new Error("down") });
    render(<MfaPanel />);
    expect(await screen.findByText(/couldn't load your two-step sign-in/)).toBeInTheDocument();
  });
});

describe("MfaChallengeForm", () => {
  const assign = vi.fn();
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
  });

  it("checks the code against the enrolled factor and goes on to where the visitor was headed", async () => {
    enrolled();
    const user = userEvent.setup();
    render(<MfaChallengeForm next="/admin/members" helpEmail="help@example.test" />);

    const go = screen.getByRole("button", { name: "Continue" });
    expect(go).toBeDisabled();
    await user.type(screen.getByLabelText(/6-digit code/), "654321");
    await user.click(go);

    await waitFor(() => expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "654321" }));
    expect(assign).toHaveBeenCalledWith("/admin/members");
  });

  it("stays put and says so when the code is wrong", async () => {
    enrolled();
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: new Error("invalid") });
    const user = userEvent.setup();
    render(<MfaChallengeForm next="/admin" helpEmail="help@example.test" />);
    await user.type(screen.getByLabelText(/6-digit code/), "111111");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/That code didn't work/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("says so when the account has no factor to check against", async () => {
    none();
    const user = userEvent.setup();
    render(<MfaChallengeForm next="/admin" helpEmail="help@example.test" />);
    await user.type(screen.getByLabelText(/6-digit code/), "111111");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/couldn't find your authenticator app/)).toBeInTheDocument();
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("points a visitor with a lost phone to the support address, and offers sign out", () => {
    render(<MfaChallengeForm next="/admin" helpEmail="help@example.test" />);
    expect(screen.getByRole("link", { name: "help@example.test" })).toHaveAttribute("href", "mailto:help@example.test");
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });
});

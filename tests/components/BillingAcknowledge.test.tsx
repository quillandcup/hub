// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { AckView } from "@/lib/billing-acknowledgements";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: nav.refresh }) }));
const actions = vi.hoisted(() => ({ acknowledge: vi.fn(), revoke: vi.fn() }));
vi.mock("@/app/(admin)/admin/hygiene/billing-reconciliation/actions", () => ({ acknowledgeBillingRow: actions.acknowledge, revokeBillingAcknowledgement: actions.revoke }));

import BillingAcknowledge from "@/components/BillingAcknowledge";

const KEY = "mbr_AAAAAAAAAAA1:event:evt_1:kp_1:1";
const view = (extra: Partial<AckView> = {}): AckView => ({ reason: "comp", note: "Seed launch, promised", by: "dana@example.test", day: "2026-05-30", statusAtAck: "missing_payment", amountCentsAtAck: 69700, state: "applies", ...extra });

beforeEach(() => {
  actions.acknowledge.mockResolvedValue({ ok: true });
  actions.revoke.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderControl = (props: Partial<Parameters<typeof BillingAcknowledge>[0]> = {}) =>
  render(<BillingAcknowledge rowKey={KEY} label="Ada: Seed Launch (Missing payment)" ack={null} canAcknowledge {...props} />);

describe("BillingAcknowledge", () => {
  it("shows nothing for a row nobody marked to someone who cannot mark", () => {
    const { container } = renderControl({ canAcknowledge: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the decision, with who and when and the note, but no controls, to someone who cannot mark", () => {
    renderControl({ ack: view(), canAcknowledge: false });
    expect(screen.getByTestId("ack-summary")).toHaveTextContent("Complimentary Marked by dana@example.test on 2026-05-30.");
    expect(screen.getByText("Seed launch, promised")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the reasons, and marks the row with the reason and note chosen", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    renderControl({ onChanged });
    await user.click(screen.getByRole("button", { name: "Mark as…" }));
    const dialog = screen.getByRole("dialog");
    const reason = within(dialog).getByRole("combobox", { name: /Reason/ });
    expect(within(reason).getAllByRole("option").map((o) => o.textContent)).toEqual(["Gift", "Complimentary", "Forfeited", "Paid elsewhere", "Other"]);
    expect(within(dialog).getByText("Complimentary: staff, a volunteer, or promised.")).toBeInTheDocument();
    await user.selectOptions(reason, "paid_elsewhere");
    expect(within(dialog).getByText(/Paid outside Stripe/)).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "PayPal, March");
    await user.click(within(dialog).getByRole("button", { name: /Mark it/ }));

    expect(actions.acknowledge).toHaveBeenCalledWith({ rowKey: KEY, reason: "paid_elsewhere", note: "PayPal, March" });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("starts on complimentary and sends no confirmation step", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Mark as…" }));
    await user.click(screen.getByRole("button", { name: /Mark it/ }));
    expect(actions.acknowledge).toHaveBeenCalledWith({ rowKey: KEY, reason: "comp", note: "" });
  });

  it("submits with Ctrl+Enter from the note", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Mark as…" }));
    await user.type(screen.getByRole("textbox", { name: /Note/ }), "Volunteer");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(actions.acknowledge).toHaveBeenCalledWith({ rowKey: KEY, reason: "comp", note: "Volunteer" });
  });

  it("keeps the form open and shows the reason when the server refuses, for example Other without a note", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    actions.acknowledge.mockResolvedValue({ ok: false, error: "Add a note saying what this is." });
    renderControl({ onChanged });
    await user.click(screen.getByRole("button", { name: "Mark as…" }));
    await user.selectOptions(screen.getByRole("combobox", { name: /Reason/ }), "other");
    expect(screen.getByPlaceholderText("What is this? A note is needed for Other.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Mark it/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a note saying what this is.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("closes the form on Cancel without saving", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Mark as…" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.acknowledge).not.toHaveBeenCalled();
  });

  it("undoes in one click, with no confirmation, and refreshes", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    renderControl({ ack: view(), onChanged });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(actions.revoke).toHaveBeenCalledWith({ rowKey: KEY });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("shows why an undo failed", async () => {
    const user = userEvent.setup();
    actions.revoke.mockResolvedValue({ ok: false, error: "Couldn't undo." });
    renderControl({ ack: view() });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't undo.");
  });

  it("says the row changed since it was marked, and still lets it be marked again or undone", () => {
    renderControl({ ack: view({ state: "changed" }) });
    expect(screen.getByText("Was marked complimentary on 2026-05-30, but it has changed since.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark again as…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});

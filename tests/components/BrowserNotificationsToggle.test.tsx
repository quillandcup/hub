// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const savePushSubscription = vi.hoisted(() => vi.fn());
const removePushSubscription = vi.hoisted(() => vi.fn());
vi.mock("@/app/(member)/settings/notificationActions", () => ({ savePushSubscription, removePushSubscription }));

const { BrowserNotificationsToggle, urlBase64ToUint8Array } = await import(
  "@/app/(member)/settings/BrowserNotificationsToggle"
);

const subscription = {
  endpoint: "https://push.example.test/abc",
  toJSON: () => ({ endpoint: "https://push.example.test/abc", keys: { p256dh: "p", auth: "a" } }),
  unsubscribe: vi.fn(async () => true),
};

/** A browser with push support, whose permission and existing subscription the test chooses. */
function fakeBrowser({ permission, existing }: { permission: NotificationPermission; existing: boolean }) {
  const pushManager = {
    getSubscription: vi.fn(async () => (existing ? subscription : null)),
    subscribe: vi.fn(async () => subscription),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal(
    "Notification",
    Object.assign(vi.fn(), { permission, requestPermission: vi.fn(async () => "granted" as const) })
  );
  return pushManager;
}

beforeEach(() => {
  savePushSubscription.mockReset().mockResolvedValue({ success: true });
  removePushSubscription.mockReset().mockResolvedValue({ success: true });
  subscription.unsubscribe.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error cleaning up the property the fake browser added
  delete navigator.serviceWorker;
});

describe("urlBase64ToUint8Array", () => {
  it("decodes URL-safe base64 without padding", () => {
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
  });
});

describe("BrowserNotificationsToggle", () => {
  it("turns notifications on for this device and tells the server", async () => {
    const pushManager = fakeBrowser({ permission: "default", existing: false });
    render(<BrowserNotificationsToggle publicKey="AAAA" readOnly={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn on for this device" }));

    expect(await screen.findByRole("button", { name: "Turn off for this device" })).toBeInTheDocument();
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(savePushSubscription).toHaveBeenCalledWith(
      { endpoint: subscription.endpoint, keys: { p256dh: "p", auth: "a" } },
      navigator.userAgent
    );
  });

  it("undoes the browser subscription when the server refuses it", async () => {
    fakeBrowser({ permission: "default", existing: false });
    savePushSubscription.mockResolvedValue({ error: "Browser notifications aren't available to you yet." });
    render(<BrowserNotificationsToggle publicKey="AAAA" readOnly={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn on for this device" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("aren't available");
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Turn on for this device" })).toBeInTheDocument();
  });

  it("shows an already-subscribed device as on and turns it off", async () => {
    fakeBrowser({ permission: "granted", existing: true });
    render(<BrowserNotificationsToggle publicKey="AAAA" readOnly={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Turn off for this device" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Turn on for this device" })).toBeInTheDocument());
    expect(removePushSubscription).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("explains a blocked permission instead of offering the button", async () => {
    fakeBrowser({ permission: "denied", existing: false });
    render(<BrowserNotificationsToggle publicKey="AAAA" readOnly={false} />);
    expect(await screen.findByText(/blocked for this site/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so when the browser can't do push", async () => {
    render(<BrowserNotificationsToggle publicKey="AAAA" readOnly={false} />);
    expect(await screen.findByText(/can't show notifications/)).toBeInTheDocument();
  });

  it("disables the button when read-only", async () => {
    fakeBrowser({ permission: "default", existing: false });
    render(<BrowserNotificationsToggle publicKey="AAAA" readOnly />);
    expect(await screen.findByRole("button", { name: "Turn on for this device" })).toBeDisabled();
  });
});

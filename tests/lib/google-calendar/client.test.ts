import { beforeEach, describe, expect, it, vi } from "vitest";

const calendar = vi.hoisted(() => ({
  events: { watch: vi.fn(), list: vi.fn() },
  channels: { stop: vi.fn() },
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: class {} },
    calendar: () => calendar,
  },
}));

import { GoogleCalendarClient } from "@/lib/google-calendar/client";

describe("GoogleCalendarClient push channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({ client_email: "sa@example.test" });
  });

  it("lists events changed since a time, cancelled ones included, across pages", async () => {
    calendar.events.list
      .mockResolvedValueOnce({ data: { items: [{ id: "a" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { items: [{ id: "b", status: "cancelled" }] } });
    const window = { updatedMin: "2026-10-28T10:55:00.000Z", timeMin: "2026-07-30T00:00:00.000Z", timeMax: "2027-01-26T00:00:00.000Z" };

    const events = await new GoogleCalendarClient().listChangedEvents("cal@example.test", window);

    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(calendar.events.list).toHaveBeenNthCalledWith(1, expect.objectContaining({ calendarId: "cal@example.test", ...window, singleEvents: true, showDeleted: true }));
    expect(calendar.events.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageToken: "p2" }));
  });

  it("opens a web_hook channel with our id, address, token and requested expiry", async () => {
    calendar.events.watch.mockResolvedValue({ data: { resourceId: "res-1", expiration: "1793000000000" } });
    const result = await new GoogleCalendarClient().watchEvents({
      calendarId: "cal@example.test",
      channelId: "chan-1",
      address: "https://app.example.test/api/webhooks/calendar",
      token: "tok",
      expiration: new Date(1792000000000),
    });
    expect(calendar.events.watch).toHaveBeenCalledWith({
      calendarId: "cal@example.test",
      requestBody: {
        id: "chan-1",
        type: "web_hook",
        address: "https://app.example.test/api/webhooks/calendar",
        token: "tok",
        expiration: "1792000000000",
      },
    });
    // The expiry Google grants wins over the one requested.
    expect(result).toEqual({ resourceId: "res-1", expiresAt: new Date(1793000000000) });
  });

  it("throws when Google's answer lacks the ids needed to stop the channel later", async () => {
    calendar.events.watch.mockResolvedValue({ data: {} });
    await expect(
      new GoogleCalendarClient().watchEvents({
        calendarId: "c",
        channelId: "x",
        address: "https://app.example.test",
        token: "t",
        expiration: new Date(),
      })
    ).rejects.toThrow("missing resourceId or expiration");
  });

  it("stops a channel by its id and resource id", async () => {
    calendar.channels.stop.mockResolvedValue({});
    await new GoogleCalendarClient().stopChannel("chan-1", "res-1");
    expect(calendar.channels.stop).toHaveBeenCalledWith({ requestBody: { id: "chan-1", resourceId: "res-1" } });
  });
});

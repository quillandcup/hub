// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { MEMBER_IDENTITY, MEMBER_USER, resetServerPageMocks, signInAs, useFakeSupabase, type FakeSupabase } from "@/tests/helpers/server-page";

vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

const { setChatNotifySetting } = await import("@/app/(member)/chat/notify-actions");
const NotifySetting = (await import("@/components/chat/NotifySetting")).default;

const CHANNEL = "chn_AAAAAAAAAAA1";
let fake: FakeSupabase;
const rpcs = () => fake.queries.filter((q) => q.table === "rpc:chat_set_notify_setting");

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  fake = useFakeSupabase({ "rpc:chat_set_notify_setting": () => ({ data: null }) });
});

describe("setChatNotifySetting", () => {
  it("saves the member's own setting for a conversation", async () => {
    await expect(setChatNotifySetting(CHANNEL, "mentions")).resolves.toEqual({ ok: true });
    expect(rpcs()[0].calls[0].args[0]).toEqual({ p_channel_id: CHANNEL, p_setting: "mentions" });
  });

  it("refuses a bad conversation id or setting, a signed-out caller and sudo, saving nothing", async () => {
    await expect(setChatNotifySetting("nope", "all")).resolves.toMatchObject({ ok: false });
    await expect(setChatNotifySetting(CHANNEL, "loud" as never)).resolves.toMatchObject({ ok: false });
    signInAs(null);
    await expect(setChatNotifySetting(CHANNEL, "all")).resolves.toMatchObject({ ok: false });
    signInAs(MEMBER_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await expect(setChatNotifySetting(CHANNEL, "all")).resolves.toEqual({ ok: false, error: expect.stringContaining("sudo") });
    expect(rpcs()).toHaveLength(0);
  });

  it("says so when the database refuses", async () => {
    fake = useFakeSupabase({ "rpc:chat_set_notify_setting": () => ({ data: null, error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(setChatNotifySetting(CHANNEL, "nothing")).resolves.toEqual({ ok: false, error: expect.stringContaining("Couldn't save") });
  });
});

describe("NotifySetting", () => {
  it("names the default for a channel and for a direct message", () => {
    render(<NotifySetting channelId={CHANNEL} initial="default" isDirect={false} />);
    expect(screen.getByRole("option", { name: "Default (mentions only)" })).toBeInTheDocument();
    cleanup();
    render(<NotifySetting channelId={CHANNEL} initial="default" isDirect />);
    expect(screen.getByRole("option", { name: "Default (every message)" })).toBeInTheDocument();
  });

  it("saves a change and shows it", async () => {
    render(<NotifySetting channelId={CHANNEL} initial="default" isDirect={false} />);
    const select = screen.getByRole("combobox", { name: "Notifications for this conversation" });

    await userEvent.selectOptions(select, "all");

    await waitFor(() => expect(rpcs()).toHaveLength(1));
    expect(rpcs()[0].calls[0].args[0]).toEqual({ p_channel_id: CHANNEL, p_setting: "all" });
    expect(select).toHaveValue("all");
  });

  it("puts the old choice back and says so when the save fails", async () => {
    fake = useFakeSupabase({ "rpc:chat_set_notify_setting": () => ({ data: null, error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<NotifySetting channelId={CHANNEL} initial="mentions" isDirect={false} />);
    const select = screen.getByRole("combobox", { name: "Notifications for this conversation" });

    await userEvent.selectOptions(select, "nothing");

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    expect(select).toHaveValue("mentions");
  });
});

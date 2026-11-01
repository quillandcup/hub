import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed } from "@/tests/helpers/event-fixtures";

// After Google sends the admin back, the Hub sends them on to the event's own address (its slug): the old
// id address only redirects there.

const EVENT_ID = "evt_AAAAAAAAAAA1";
const SLUG = "spring-retreat-2097-04-10";
let repos = createInMemoryRepos();
let adminOk = true;
let stateEventId: string | null = EVENT_ID;
let tokenFails = false;

vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (adminOk ? { user: { id: "admin" }, supabase: {} } : { user: null }),
}));
vi.mock("@/lib/google-photos-picker/redirect-uri", () => ({ redirectUriFor: () => "http://localhost/cb" }));
vi.mock("@/lib/google-photos-picker/client", () => ({
  exchangeCodeForToken: async () => {
    if (tokenFails) throw new Error("token exchange failed");
    return { accessToken: "token", expiresInSeconds: 3600 };
  },
  createPickerSession: async () => ({ id: "session", pickerUri: "https://picker.example/s" }),
}));
vi.mock("@/lib/google-photos-picker/import-session-cookie", () => ({
  setImportSessionCookie: vi.fn(async () => {}),
  verifyAndConsumeOAuthState: async () => stateEventId,
}));

import { GET } from "@/app/api/oauth/google/callback/route";

const call = (query: string) => GET(new NextRequest(`http://localhost/api/oauth/google/callback?${query}`));
const location = (res: Response) => new URL(res.headers.get("location")!);

beforeEach(() => {
  adminOk = true;
  stateEventId = EVENT_ID;
  tokenFails = false;
  console.error = vi.fn();
  repos = createInMemoryRepos(new InMemoryDataset({ ...eventSeed([{ id: EVENT_ID, slug: SLUG, title: "Spring Retreat" }]) }));
});

describe("GET /api/oauth/google/callback", () => {
  it("sends the admin to the event's photo import at its slug", async () => {
    const res = await call(`code=abc&state=${EVENT_ID}:x`);
    expect(location(res).pathname).toBe(`/admin/events/${SLUG}/import-photos`);
  });

  it("sends a failed start back to the event at its slug, with why", async () => {
    tokenFails = true;
    const res = await call(`code=abc&state=${EVENT_ID}:x`);
    expect(location(res).pathname).toBe(`/admin/events/${SLUG}`);
    expect(location(res).searchParams.get("photo_import_error")).toBe("start_failed");
  });

  it("falls back to the id address when the event can't be read (it redirects to the slug)", async () => {
    stateEventId = "evt_ZZZZZZZZZZZ9";
    const res = await call(`code=abc&state=evt_ZZZZZZZZZZZ9:x`);
    expect(location(res).pathname).toBe("/admin/events/evt_ZZZZZZZZZZZ9/import-photos");
  });

  it("sends a state that doesn't verify to the event list's error banner, never anywhere off the admin pages", async () => {
    stateEventId = null;
    const res = await call(`code=abc&state=${EVENT_ID}:forged`);
    expect(location(res).pathname.startsWith("/admin/events")).toBe(true);
    expect(location(res).searchParams.get("photo_import_error")).toBe("invalid_state");
  });

  it("reports Google's own error, and a missing code", async () => {
    expect(location(await call(`error=access_denied&state=${EVENT_ID}:x`)).searchParams.get("photo_import_error")).toBe("access_denied");
    expect(location(await call(`state=${EVENT_ID}:x`)).searchParams.get("photo_import_error")).toBe("missing_code");
  });

  it("is a 401 for a signed-out caller", async () => {
    adminOk = false;
    expect((await call("code=abc&state=x")).status).toBe(401);
  });
});

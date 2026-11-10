/**
 * What a Slack reader who isn't signed in to the Hub gets from the "Watch it in Hub Chat" link in a shared-video message
 * (`sharedVideoSlackLine`, lib/chat/video-link.ts): the proxy sends them to /login without exposing the message, remembers
 * the link (query and all) in the `hub_next` cookie, and the sign-in paths bring them back to exactly that message
 * (`takeNextPath`). A signed-in member goes straight through. The link is taken from the real Slack text, so a change to its
 * shape that the proxy or the return path would mishandle fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));

const state: { user: { id: string } | null; tokenClaims: Record<string, unknown> | null } = { user: null, tokenClaims: null };
const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      getSession: async () => ({ data: { session: state.tokenClaims ? { access_token: `${b64({ alg: "ES256", typ: "JWT" })}.${b64(state.tokenClaims)}.sig` } : null } }),
    },
    from: () => {
      const chain = { select: () => chain, insert: async () => ({}), eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
      return chain;
    },
  }),
}));

// takeNextPath reads the cookie store a sign-in route handler has; here it is whatever the browser sent back.
const browserCookies = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => browserCookies.get(name), delete: (name: string) => browserCookies.delete(name) }),
}));

import { proxy } from "@/proxy";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { sharedVideoSlackLine } from "@/lib/chat/video-link";
import { takeNextPath } from "@/lib/next-path-cookie";
import { NEXT_PATH_COOKIE, safeNextPath } from "@/lib/safe-next";
import { GATES, gateHref } from "@/lib/gates";

const CHANNEL = "chn_AAAAAAAAAAA1";
const MESSAGE = "msg_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const SLACK_CHANNEL = "C_HOSTS";

/** The "Watch it in Hub Chat" address exactly as the Slack message carries it, as a path, anchor included. The proxy sees only the path and query: a fragment never leaves the browser. */
async function slackLinkPath(): Promise<string> {
  const repos = createInMemoryRepos(
    new InMemoryDataset({
      chatChannels: [{ id: CHANNEL, slack_channel_id: SLACK_CHANNEL }],
      courses: [{ id: "crs_AAAAAAAAAAA1", slug: "ready-writer" } as never],
      courseLessons: [{ id: LESSON, course_id: "crs_AAAAAAAAAAA1" } as never],
      chatMessageVideos: [{ id: "cmv_AAAAAAAAAAA1", message_id: MESSAGE, lesson_id: LESSON, open_to_channel: false, created_at: "2026-01-01T00:00:00Z" }],
    }),
  );
  const line = (await sharedVideoSlackLine(repos, MESSAGE, SLACK_CHANNEL)) as string;
  const url = /<([^|>]+)\|Watch it in Hub Chat>/.exec(line)![1];
  expect(url.startsWith(APP_URL)).toBe(true);
  return url.slice(APP_URL.length);
}

/** What the server is asked for: the address without its #fragment. */
const serverSees = (path: string) => path.split("#", 1)[0];

const call = async (path: string, headers: Record<string, string> = {}) => {
  const req = new NextRequest(`http://localhost:3000${path}`);
  for (const [name, value] of Object.entries(headers)) req.headers.set(name, value);
  return proxy(req);
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  state.user = null;
  state.tokenClaims = null;
  browserCookies.clear();
});

describe("a signed-out visitor following the Slack link to a shared video", () => {
  it("is sent to /login without the message in the address, and the link is remembered in full", async () => {
    const path = await slackLinkPath();
    expect(path).toBe(`/chat/${CHANNEL}?m=${MESSAGE}`);

    const res = await call(path);

    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/login");
    expect(location.search).toBe("");
    expect(decodeURIComponent(res.cookies.get(NEXT_PATH_COOKIE)?.value ?? "")).toBe(serverSees(path));
    // Not readable by scripts on the page, so a stray script can't read where they were headed.
    expect(res.cookies.get(NEXT_PATH_COOKIE)?.httpOnly).toBe(true);
  });

  it("is brought back to exactly that message once they have signed in", async () => {
    const path = await slackLinkPath();
    const res = await call(path);
    // The browser keeps the cookie the proxy set and sends it with the sign-in request.
    browserCookies.set(NEXT_PATH_COOKIE, { value: decodeURIComponent(res.cookies.get(NEXT_PATH_COOKIE)?.value ?? "") });

    expect(await takeNextPath("/dashboard")).toBe(serverSees(path));
    // It is used once: a second sign-in doesn't send them there again.
    expect(await takeNextPath("/dashboard")).toBe("/dashboard");
  });

  // Sign-in uses the remembered address up. If the chat page then sends them on to connect Slack, that gate carries the page itself
  // (lib/gates.ts: `?next=`, through Settings and Slack's approval page), so nothing depends on the sign-in cookie lasting.
  it("is carried on by the connect-Slack gate after sign-in has used the address up", async () => {
    const path = await slackLinkPath();
    const res = await call(path);
    browserCookies.set(NEXT_PATH_COOKIE, { value: decodeURIComponent(res.cookies.get(NEXT_PATH_COOKIE)?.value ?? "") });

    const afterSignIn = await takeNextPath("/dashboard");
    expect(afterSignIn).toBe(serverSees(path));
    expect(browserCookies.has(NEXT_PATH_COOKIE)).toBe(false);
    expect(await takeNextPath("/dashboard")).toBe("/dashboard");
    // The chat page, opened at that address, sends the member through the gate with it attached.
    expect(new URL(`http://x${gateHref(GATES.connectSlack, afterSignIn)}`).searchParams.get("next")).toBe(serverSees(path));
  });

  // The link is the message's permalink (`?m=`), in the query, so the whole of it reaches the server and survives sign-in: the member lands on
  // the message, scrolled to and highlighted, even one that is further back than the newest page, and a reply opens its thread.
  it("remembers the whole permalink through sign-in, the message included", async () => {
    const path = await slackLinkPath();
    expect(path).not.toContain("#");

    const res = await call(path);

    expect(decodeURIComponent(res.cookies.get(NEXT_PATH_COOKIE)?.value ?? "")).toBe(`/chat/${CHANNEL}?m=${MESSAGE}`);
  });

  it("is accepted as a safe return address, query included", async () => {
    expect(safeNextPath(serverSees(await slackLinkPath()))).toBe(`/chat/${CHANNEL}?m=${MESSAGE}`);
  });

  it("doesn't remember a router prefetch as somewhere they asked to go", async () => {
    const res = await call(await slackLinkPath(), { "next-router-prefetch": "1" });

    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
    expect(res.cookies.getAll()).toHaveLength(0);
  });

  it("is also sent to /login for the conversation address without a message, so no chat page opens signed out", async () => {
    const res = await call(`/chat/${CHANNEL}`);

    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
  });
});

describe("a signed-in member following the same link", () => {
  it("goes straight through to the chat page, with no redirect and no remembered address", async () => {
    state.user = { id: "user-fern" };
    state.tokenClaims = { sub: "user-fern", role: "authenticated", session_id: "s1" };

    const res = await call(await slackLinkPath());

    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(NEXT_PATH_COOKIE)).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { MILESTONE_PHOTO } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import type { Visibility } from "@/lib/writing-visibility";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const TOKEN = "a".repeat(32);
const BOOK_TOKEN = "b".repeat(32);

const state: {
  user: { id: string } | null;
  identity: { memberId: string; isSudo: boolean } | null;
  staff: boolean;
  flag: boolean;
  pageOn: boolean;
  repos: Repos;
  dataset: InMemoryDataset;
} = { user: null, identity: null, staff: false, flag: true, pageOn: true, repos: undefined as never, dataset: undefined as never };
const files = new Map<string, Buffer>();
const flagAsked: string[] = [];

vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: async () => state.identity }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
vi.mock("@/lib/writer-profiles-access", () => ({
  memberHasWriterProfiles: async (_repos: unknown, memberId: string) => {
    flagAsked.push(memberId);
    return state.flag;
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("milestone-photos");
        return {
          download: async (path: string) => {
            const bytes = files.get(path);
            return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: "Object not found" } };
          },
        };
      },
    },
  }),
}));

import { GET } from "@/app/api/milestone-photos/[token]/route";

const ask = (token: string) => GET(new Request(`http://localhost/api/milestone-photos/${token}`), { params: Promise.resolve({ token }) });
const asMember = (memberId: string) => {
  state.user = { id: `user-${memberId}` };
  state.identity = { memberId, isSudo: false };
};
const asVisitor = () => {
  state.user = null;
  state.identity = null;
};
let milestoneId = "";
let image: Buffer;

/** Ada's THE END photo at a level. */
async function photoAt(level: Visibility, consent = false) {
  const row = state.dataset.memberMilestones.find((m) => m.id === milestoneId)!;
  Object.assign(row, { visibility: level, consent_testimonial: consent, photo_path: `${ADA}/${TOKEN}.webp`, photo_alt: "Desk" });
  files.set(`${ADA}/${TOKEN}.webp`, image);
}

beforeEach(async () => {
  state.dataset = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example", email: "ada@example.test" },
      { id: BO, name: "Bo Example", email: "bo@example.test" },
    ],
  });
  state.dataset.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: ADA, title: "A Fake Book", published_date: "2026-01-01", cover_asset_id: null });
  state.repos = createInMemoryRepos(state.dataset);
  const answer = { status: "confirmed" as const, achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: null, consent_testimonial: false };
  milestoneId = (await state.repos.milestones.addOwn({ memberId: ADA, kind: "the_end", answer, work: { projectId: null, bookId: null, title: "A Fake Novel" }, createdBy: "u" }, new Date())).milestone.id;
  image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#48a" } }).webp().toBuffer();
  files.clear();
  flagAsked.length = 0;
  state.staff = false;
  state.flag = true;
  state.pageOn = true;
  vi.spyOn(state.repos.profiles, "isAdmin").mockImplementation(async () => state.staff);
  vi.spyOn(state.repos.writerProfiles, "isOnForMember").mockImplementation(async () => state.pageOn);
  vi.spyOn(console, "error").mockImplementation(() => {});
  asVisitor();
});

const NOT_FOUND = { status: 404, cache: "private, no-store" };
const outcome = async (token = TOKEN) => {
  const response = await ask(token);
  return { status: response.status, cache: response.headers.get("cache-control"), response };
};

describe("GET /api/milestone-photos/<token>", () => {
  it("serves the member their own photo at every level, never cached by a shared cache unless it is for the web", async () => {
    asMember(ADA);
    for (const level of ["private", "community"] as const) {
      await photoAt(level);
      const { status, cache, response } = await outcome();
      expect(status).toBe(200);
      expect(cache).toBe("private, no-store");
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    }
  });

  it("serves another signed-in member the house and the globe, never the lock, and says nothing about a hidden photo", async () => {
    asMember(BO);
    await photoAt("private");
    expect(await outcome()).toMatchObject(NOT_FOUND);
    await photoAt("community");
    expect(await outcome()).toMatchObject({ status: 200, cache: "private, no-store" });
    await photoAt("public");
    expect(await outcome()).toMatchObject({ status: 200 });
    // The hidden one looks like one that never existed: same status, same headers, same body.
    await photoAt("private");
    const hidden = await ask(TOKEN);
    const missing = await ask("c".repeat(32));
    expect(hidden.status).toBe(missing.status);
    expect(await hidden.text()).toBe(await missing.text());
    expect([...hidden.headers.entries()]).toEqual([...missing.headers.entries()]);
  });

  it("serves a visitor with no sign-in only the globe, only while the writer profile flag and the page are on, and lets only that be cached", async () => {
    asVisitor();
    for (const level of ["private", "community"] as const) {
      await photoAt(level);
      expect(await outcome()).toMatchObject(NOT_FOUND);
    }
    await photoAt("public");
    const served = await outcome();
    expect(served.status).toBe(200);
    expect(served.cache).toBe(`public, max-age=${MILESTONE_PHOTO.webCacheSeconds}, s-maxage=${MILESTONE_PHOTO.webCacheSeconds}`);

    state.flag = false;
    expect(await outcome()).toMatchObject(NOT_FOUND);
    state.flag = true;
    state.pageOn = false;
    expect(await outcome()).toMatchObject(NOT_FOUND);
  });

  it("does not let a shared cache keep a globe photo that a member was shown while the page is off", async () => {
    await photoAt("public");
    state.pageOn = false;
    asMember(BO);
    expect(await outcome()).toMatchObject({ status: 200, cache: "private, no-store" });
    asMember(ADA);
    expect(await outcome()).toMatchObject({ status: 200, cache: "private, no-store" });
  });

  it("asks about the flag only for a photo a visitor could ever have", async () => {
    await photoAt("community");
    asMember(BO);
    await outcome();
    expect(flagAsked).toEqual([]);
    await photoAt("public");
    await outcome();
    expect(flagAsked).toEqual([ADA]);
  });

  it("shows staff who are not the member a photo only when the member ticked 'Allow us to celebrate you publicly', whatever its level", async () => {
    state.user = { id: "staff-user" };
    state.identity = null;
    state.staff = true;
    await photoAt("private");
    expect(await outcome()).toMatchObject(NOT_FOUND);
    await photoAt("private", true);
    expect(await outcome()).toMatchObject({ status: 200, cache: "private, no-store" });
    state.staff = false;
    expect(await outcome()).toMatchObject(NOT_FOUND);
  });

  it("treats staff viewing as a member (sudo) as that member, so they look at what the member sees", async () => {
    state.user = { id: "staff-user" };
    state.identity = { memberId: ADA, isSudo: true };
    state.staff = true;
    await photoAt("private");
    expect(await outcome()).toMatchObject({ status: 200 });
  });

  it("is a 404 for a milestone that was taken back, declined or never confirmed, and for a deleted book's photo", async () => {
    asMember(ADA);
    await photoAt("public");
    await state.repos.milestones.takeBack(milestoneId, ADA, new Date());
    expect(await outcome()).toMatchObject(NOT_FOUND);

    const answer = { status: "confirmed" as const, achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: null, consent_testimonial: false };
    const declined = (await state.repos.milestones.addOwn({ memberId: ADA, kind: "publish_ready", answer, work: { projectId: null, bookId: null, title: "Another Fake" }, createdBy: "u" }, new Date())).milestone.id;
    await state.repos.milestones.setPhoto(declined, ADA, `${ADA}/${"d".repeat(32)}.webp`, null, new Date());
    files.set(`${ADA}/${"d".repeat(32)}.webp`, image);
    await state.repos.milestones.answer(declined, ADA, { status: "declined" }, new Date());
    expect(await outcome("d".repeat(32))).toMatchObject(NOT_FOUND);

    await state.repos.milestones.setBookPhoto("book_AAAAAAAAAAA1", ADA, `${ADA}/${BOOK_TOKEN}.webp`, null, new Date());
    files.set(`${ADA}/${BOOK_TOKEN}.webp`, image);
    expect((await outcome(BOOK_TOKEN)).status).toBe(200);
    state.dataset.memberBooks[0].deleted_at = new Date().toISOString();
    expect(await outcome(BOOK_TOKEN)).toMatchObject(NOT_FOUND);
  });

  it("serves the Published photo to a visitor on the same rule as the globe", async () => {
    await state.repos.milestones.setBookPhoto("book_AAAAAAAAAAA1", ADA, `${ADA}/${BOOK_TOKEN}.webp`, null, new Date());
    files.set(`${ADA}/${BOOK_TOKEN}.webp`, image);
    asVisitor();
    expect((await outcome(BOOK_TOKEN)).status).toBe(200);
    state.pageOn = false;
    expect(await outcome(BOOK_TOKEN)).toMatchObject(NOT_FOUND);
  });

  it("is a 404 for a token that is not 128 random bits, an unknown token, and a row whose file is gone", async () => {
    asMember(ADA);
    await photoAt("community");
    for (const token of ["short", "A".repeat(32), "../../etc/passwd", "%", "0".repeat(31), "g".repeat(32)]) expect(await outcome(token)).toMatchObject(NOT_FOUND);
    expect(await outcome("e".repeat(32))).toMatchObject(NOT_FOUND);
    files.clear();
    expect(await outcome()).toMatchObject(NOT_FOUND);
  });

  it("sends headers that keep a picture a picture: no sniffing, no scripts, not indexed", async () => {
    asMember(ADA);
    await photoAt("community");
    const { response } = await outcome();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("content-disposition")).toBe("inline");
  });

  it("is a 500 that is never cached when the database fails", async () => {
    vi.spyOn(state.repos.milestones, "photoByToken").mockRejectedValue(new Error("database down"));
    const { status, cache } = await outcome();
    expect(status).toBe(500);
    expect(cache).toBe("private, no-store");
  });
});

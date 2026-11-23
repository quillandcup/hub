import { describe, expect, it } from "vitest";
import { MILESTONE_PHOTO } from "@/lib/config";
import {
  ANONYMOUS_VIEWER,
  decidePhotoAccess,
  isPhotoToken,
  milestonePhotoPath,
  milestonePhotoSrc,
  parsePhotoAlt,
  photoCacheControl,
  tokenOfPath,
  type PhotoViewer,
} from "@/lib/milestone-photos";
import { VISIBILITIES, type Visibility } from "@/lib/writing-visibility";
import { MILESTONE_PHOTO_ALT, MILESTONE_PHOTO_PROMPT, hasSomethingToShare, milestonePhotoLine, publishedPhotoLine } from "@/lib/finishers";

const OWNER = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const TOKEN = "0123456789abcdef0123456789abcdef";

const owner: PhotoViewer = { signedIn: true, memberId: OWNER, isStaff: false };
const member: PhotoViewer = { signedIn: true, memberId: OTHER, isStaff: false };
const staff: PhotoViewer = { signedIn: true, memberId: null, isStaff: true };
const staffMember: PhotoViewer = { signedIn: true, memberId: OTHER, isStaff: true };
const signedInNoRecord: PhotoViewer = { signedIn: true, memberId: null, isStaff: false };

const decide = (level: Visibility, viewer: PhotoViewer, webOn: boolean, consentTestimonial = false) => decidePhotoAccess({ ownerId: OWNER, level, consentTestimonial }, viewer, webOn);

describe("decidePhotoAccess: who may be handed a photo", () => {
  it("always gives the member their own photo, and lets a shared cache keep it only when a visitor could have it too", () => {
    for (const level of VISIBILITIES) {
      expect(decide(level, owner, false)).toEqual({ allowed: true, cache: "private" });
    }
    expect(decide("public", owner, true)).toEqual({ allowed: true, cache: "web" });
    expect(decide("community", owner, true)).toEqual({ allowed: true, cache: "private" });
  });

  it("gives another signed-in member the house and the globe, never the lock", () => {
    expect(decide("private", member, true)).toEqual({ allowed: false });
    expect(decide("community", member, false)).toEqual({ allowed: true, cache: "private" });
    expect(decide("public", member, false)).toEqual({ allowed: true, cache: "private" });
    expect(decide("public", member, true)).toEqual({ allowed: true, cache: "web" });
  });

  it("gives a visitor the globe only, and only while the member's page is on", () => {
    expect(decide("private", ANONYMOUS_VIEWER, true)).toEqual({ allowed: false });
    expect(decide("community", ANONYMOUS_VIEWER, true)).toEqual({ allowed: false });
    expect(decide("public", ANONYMOUS_VIEWER, false)).toEqual({ allowed: false });
    expect(decide("public", ANONYMOUS_VIEWER, true)).toEqual({ allowed: true, cache: "web" });
  });

  it("gives a user with no member record only what a visitor gets", () => {
    expect(decide("community", signedInNoRecord, true)).toEqual({ allowed: false });
    expect(decide("public", signedInNoRecord, false)).toEqual({ allowed: false });
    expect(decide("public", signedInNoRecord, true)).toEqual({ allowed: true, cache: "web" });
  });

  it("gives staff who are not the member a photo only when the member ticked 'Share my story', at any level", () => {
    for (const level of VISIBILITIES) {
      expect(decide(level, staff, false)).toEqual({ allowed: false });
    }
    expect(decide("private", staff, false, true)).toEqual({ allowed: true, cache: "private" });
    expect(decide("community", staff, false, true)).toEqual({ allowed: true, cache: "private" });
  });

  it("gives a staff member who is also a member what any member gets, plus what the consent opens", () => {
    expect(decide("private", staffMember, false)).toEqual({ allowed: false });
    expect(decide("community", staffMember, false)).toEqual({ allowed: true, cache: "private" });
    expect(decide("private", staffMember, false, true)).toEqual({ allowed: true, cache: "private" });
  });

  it("never lets a shared cache keep what a visitor could not have", () => {
    for (const level of VISIBILITIES) {
      for (const webOn of [true, false]) {
        for (const viewer of [owner, member, staff, staffMember, signedInNoRecord, ANONYMOUS_VIEWER]) {
          const decision = decide(level, viewer, webOn, true);
          if (decision.allowed && decision.cache === "web") {
            expect(decide(level, ANONYMOUS_VIEWER, webOn)).toEqual({ allowed: true, cache: "web" });
          }
        }
      }
    }
  });
});

describe("photoCacheControl", () => {
  it("keeps anything but the web's photo out of every shared cache and stores nothing", () => {
    expect(photoCacheControl("private")).toBe("private, no-store");
  });

  it("lets the web's photo sit in a shared cache for the configured time and no longer", () => {
    expect(photoCacheControl("web")).toBe(`public, max-age=${MILESTONE_PHOTO.webCacheSeconds}, s-maxage=${MILESTONE_PHOTO.webCacheSeconds}`);
    expect(MILESTONE_PHOTO.webCacheSeconds).toBeLessThanOrEqual(300);
  });
});

describe("the address of a photo", () => {
  it("is a random token in a path of the member's own folder, and asked for from the route", () => {
    expect(milestonePhotoPath(OWNER, TOKEN)).toBe(`${OWNER}/${TOKEN}.webp`);
    expect(tokenOfPath(milestonePhotoPath(OWNER, TOKEN))).toBe(TOKEN);
    expect(milestonePhotoSrc(TOKEN)).toBe(`/api/milestone-photos/${TOKEN}`);
    expect(milestonePhotoSrc(TOKEN)).not.toContain(OWNER);
  });

  it("accepts only 128 bits of lower-case hex", () => {
    expect(isPhotoToken(TOKEN)).toBe(true);
    for (const bad of ["", "abc", TOKEN.toUpperCase(), `${TOKEN}0`, TOKEN.slice(1), "../" + TOKEN.slice(3), `${TOKEN.slice(1)}%`, null, undefined, 5]) {
      expect(isPhotoToken(bad)).toBe(false);
    }
  });

  it("reads the token out of a stored path, and nothing out of anything else", () => {
    for (const bad of [null, undefined, "", "no-slash.webp", `${OWNER}/short.webp`, `${OWNER}/${TOKEN}.png`, `${OWNER}/sub/${TOKEN}.webp`]) {
      expect(tokenOfPath(bad)).toBeNull();
    }
  });
});

describe("parsePhotoAlt", () => {
  it("keeps one line of plain text, or none", () => {
    expect(parsePhotoAlt("  Me   at my\n desk ")).toEqual({ alt: "Me at my desk" });
    expect(parsePhotoAlt("   ")).toEqual({ alt: null });
    expect(parsePhotoAlt("")).toEqual({ alt: null });
    expect(parsePhotoAlt(null)).toEqual({ alt: null });
    expect(parsePhotoAlt(undefined)).toEqual({ alt: null });
  });

  it("refuses what is too long and what is not text", () => {
    expect(parsePhotoAlt("x".repeat(MILESTONE_PHOTO.altMaxLength))).toEqual({ alt: "x".repeat(MILESTONE_PHOTO.altMaxLength) });
    expect(parsePhotoAlt("x".repeat(MILESTONE_PHOTO.altMaxLength + 1))).toHaveProperty("error");
    expect(parsePhotoAlt(42)).toHaveProperty("error");
    expect(parsePhotoAlt({ toString: () => "x" })).toHaveProperty("error");
  });
});

describe("the words around a photo", () => {
  it("says, for every level, who sees it, without promising more than will happen", () => {
    expect(milestonePhotoLine("private", { available: true, on: true })).toMatch(/Only you/);
    expect(milestonePhotoLine("community", { available: true, on: true })).toMatch(/Other members .* not on the web/);
    expect(milestonePhotoLine("public", { available: false, on: false })).toMatch(/not on the web, because writer profiles are not open to you yet/);
    expect(milestonePhotoLine("public", { available: true, on: false })).toMatch(/goes on the web once your writer profile is on/);
    expect(milestonePhotoLine("public", { available: true, on: true })).toMatch(/Anyone on the internet/);
    expect(publishedPhotoLine({ available: true, on: true })).toBe(milestonePhotoLine("public", { available: true, on: true }));
    // A book's photo has the book's level.
    expect(publishedPhotoLine({ available: true, on: true }, "public")).toBe(milestonePhotoLine("public", { available: true, on: true }));
    expect(publishedPhotoLine({ available: true, on: true }, "private")).toMatch(/Only you .* this book is private/);
    expect(publishedPhotoLine({ available: true, on: true }, "community")).toMatch(/Other members .* the same as this book\. It is not on the web/);
  });

  it("hands a book's photo at the lock to nobody but its member: not another member, not a visitor, not staff (a book has no 'Share my story' tick)", () => {
    const book = (viewer: PhotoViewer, webOn = true) => decidePhotoAccess({ ownerId: OWNER, level: "private", consentTestimonial: false }, viewer, webOn);
    expect(book(owner)).toEqual({ allowed: true, cache: "private" });
    for (const viewer of [member, staff, staffMember, signedInNoRecord, ANONYMOUS_VIEWER]) expect(book(viewer)).toEqual({ allowed: false });
    // At the house a book's photo is for members, and never for a visitor or for staff who are not members' viewers of it.
    const house = (viewer: PhotoViewer) => decidePhotoAccess({ ownerId: OWNER, level: "community", consentTestimonial: false }, viewer, true);
    expect(house(member)).toEqual({ allowed: true, cache: "private" });
    expect(house(ANONYMOUS_VIEWER)).toEqual({ allowed: false });
  });

  it("has a description and a prompt for every step, THE END, publish-ready and Published", () => {
    for (const step of ["the_end", "publish_ready", "published"] as const) {
      expect(MILESTONE_PHOTO_ALT[step].length).toBeGreaterThan(10);
      expect(MILESTONE_PHOTO_PROMPT[step]).toMatch(/if you have one\.$/);
    }
  });

  it("counts a photo as something to share, like a story", () => {
    expect(hasSomethingToShare({ storyBefore: null, storyAfter: null })).toBe(false);
    expect(hasSomethingToShare({ storyBefore: " ", storyAfter: null, photo: null })).toBe(false);
    expect(hasSomethingToShare({ storyBefore: null, storyAfter: "Done.", photo: null })).toBe(true);
    expect(hasSomethingToShare({ storyBefore: null, storyAfter: null, photo: { token: TOKEN, alt: null } })).toBe(true);
  });
});

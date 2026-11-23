import { describe, expect, it, vi } from "vitest";
import appConfig from "@/config/app";
import { SITE_URL, WRITER_PROFILES } from "@/lib/config";
import {
  BIO_MAX_LENGTH,
  HANDLE_PROBLEM_MESSAGES,
  cleanBio,
  isHandleShaped,
  isProfilePubliclyServable,
  isReservedHandle,
  normalizeHandle,
  publicName,
  publishablePhotoUrl,
  suggestHandle,
  validateHandle,
  writerProfilePath,
  writerProfileUrl,
} from "@/lib/writer-profile";

// The state after the cutover (config/app.ts publicSiteLive true); tests/lib/public-site-flag-off.test.ts has the state before.
vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.liveConfigModule()));

const { handleMinLength: MIN, handleMaxLength: MAX } = WRITER_PROFILES;

describe("validateHandle", () => {
  it("accepts lowercase letters, digits and single hyphens, and returns the stored form", () => {
    expect(validateHandle("ada-example")).toEqual({ ok: true, handle: "ada-example" });
    expect(validateHandle("  Ada-Example2 ")).toEqual({ ok: true, handle: "ada-example2" });
    expect(validateHandle("a1b")).toEqual({ ok: true, handle: "a1b" });
  });

  it("refuses an empty handle", () => {
    expect(validateHandle("   ")).toMatchObject({ ok: false, problem: "empty" });
  });

  it("holds the length limits from config, on both sides", () => {
    expect(validateHandle("a".repeat(MIN - 1))).toMatchObject({ ok: false, problem: "too_short" });
    expect(validateHandle("a".repeat(MIN))).toMatchObject({ ok: true });
    expect(validateHandle("a".repeat(MAX))).toMatchObject({ ok: true });
    expect(validateHandle("a".repeat(MAX + 1))).toMatchObject({ ok: false, problem: "too_long" });
  });

  it.each(["ada example", "ada_example", "-ada", "ada-", "ada--example", "ada.example", "ada/example", "ada@example", "adá-example", "../admin", "ada\nexample"])(
    "refuses %j as a handle",
    (input) => {
      expect(validateHandle(input)).toMatchObject({ ok: false, problem: "characters" });
    }
  );

  it("says why in plain words", () => {
    const result = validateHandle("Ada Example");
    expect(result).toEqual({ ok: false, problem: "characters", message: HANDLE_PROBLEM_MESSAGES.characters });
    expect(HANDLE_PROBLEM_MESSAGES.too_short).toContain(String(MIN));
    expect(HANDLE_PROBLEM_MESSAGES.too_long).toContain(String(MAX));
  });
});

describe("reserved words", () => {
  it("refuses every word in the config list, in any case", () => {
    for (const word of WRITER_PROFILES.reservedHandles) {
      const handle = word.length >= MIN ? word : null;
      if (!handle) continue; // too short to be chosen anyway
      expect(validateHandle(handle.toUpperCase()), word).toMatchObject({ ok: false, problem: "reserved" });
    }
  });

  it("covers the places in the app, the community and its staff", () => {
    for (const word of ["admin", "api", "settings", "login", "help", "support", "hedgie", "quillandcup", "staff", "sitemap", "robots"]) {
      expect(WRITER_PROFILES.reservedHandles.map((w) => w.replace(/-/g, "")), word).toContain(word);
    }
  });

  it("holds a word whatever hyphens are put in it", () => {
    expect(isReservedHandle("quill-and-cup")).toBe(true);
    expect(isReservedHandle("hedgie-hub")).toBe(true);
    expect(isReservedHandle("ad-min")).toBe(true);
    expect(validateHandle("quill-and-cup")).toMatchObject({ ok: false, problem: "reserved" });
  });

  it("does not hold a name that only contains a reserved word", () => {
    expect(isReservedHandle("admin-ada")).toBe(false);
    expect(validateHandle("ada-support")).toMatchObject({ ok: true });
  });

  it("keeps the list itself clean: lowercase letters and digits with single hyphens, no duplicates", () => {
    const list = WRITER_PROFILES.reservedHandles;
    expect(list.every((w) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(w))).toBe(true);
    expect(new Set(list).size).toBe(list.length);
  });

  it("is read from config/app.ts, not repeated in code", () => {
    expect(WRITER_PROFILES).toBe(appConfig.writerProfiles);
  });
});

describe("isHandleShaped", () => {
  it("accepts the shape in any case and refuses the rest", () => {
    expect(isHandleShaped("Ada-Example")).toBe(true);
    expect(isHandleShaped("a")).toBe(true);
    expect(isHandleShaped("ada--b")).toBe(false);
    expect(isHandleShaped("ada b")).toBe(false);
    expect(isHandleShaped("a".repeat(64))).toBe(false);
  });
});

describe("normalizeHandle and addresses", () => {
  it("trims and lowercases", () => {
    expect(normalizeHandle("  Ada-Example ")).toBe("ada-example");
  });

  it("builds the page address from the public site URL and the /w path", () => {
    expect(writerProfilePath("ada-example")).toBe("/w/ada-example");
    expect(writerProfileUrl("ada-example")).toBe(`${SITE_URL}/w/ada-example`);
  });
});

describe("suggestHandle", () => {
  it("makes a handle from the name shown", () => {
    expect(suggestHandle("Ada Example")).toBe("ada-example");
    expect(suggestHandle("  Ada   O'Example!  ")).toBe("ada-o-example");
  });

  it("drops accents and keeps within the length limit", () => {
    expect(suggestHandle("José Ejemplo")).toBe("jose-ejemplo");
    const long = suggestHandle("a".repeat(MAX + 20));
    expect(long.length).toBeLessThanOrEqual(MAX);
    expect(validateHandle(long).ok).toBe(true);
  });

  it("suggests nothing when nothing usable is left, or the result is a kept word or too short", () => {
    expect(suggestHandle("!!!")).toBe("");
    expect(suggestHandle("Admin")).toBe("");
    expect(suggestHandle("Al")).toBe("");
    expect(suggestHandle("")).toBe("");
  });
});

describe("cleanBio", () => {
  it("keeps plain text, trimmed, with long runs of blank lines folded", () => {
    expect(cleanBio("  Hello\r\n\r\n\r\n\r\nthere  ")).toEqual({ ok: true, bio: "Hello\n\nthere" });
  });

  it("returns null for nothing", () => {
    expect(cleanBio("   ")).toEqual({ ok: true, bio: null });
    expect(cleanBio(null)).toEqual({ ok: true, bio: null });
  });

  it("refuses a bio over the limit, and allows exactly the limit", () => {
    expect(cleanBio("x".repeat(BIO_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(cleanBio("x".repeat(BIO_MAX_LENGTH + 1))).toEqual({ ok: false, message: expect.stringContaining(String(BIO_MAX_LENGTH)) });
  });

  it("does not interpret markup: it is returned as the text it is", () => {
    expect(cleanBio("<script>alert(1)</script>")).toEqual({ ok: true, bio: "<script>alert(1)</script>" });
  });
});

describe("publishablePhotoUrl", () => {
  it("allows an https picture", () => {
    expect(publishablePhotoUrl("https://avatars.example.com/a.png")).toBe("https://avatars.example.com/a.png");
  });

  it("never allows a picture that is not https, is missing or is not an address", () => {
    expect(publishablePhotoUrl("http://avatars.example.com/a.png")).toBeNull();
    expect(publishablePhotoUrl("javascript:alert(1)")).toBeNull();
    expect(publishablePhotoUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(publishablePhotoUrl("not a url")).toBeNull();
    expect(publishablePhotoUrl(null)).toBeNull();
    expect(publishablePhotoUrl(undefined)).toBeNull();
  });

  it("never allows a host listed in config, because its address carries a hash of the email", () => {
    for (const host of WRITER_PROFILES.unpublishablePhotoHosts) {
      expect(publishablePhotoUrl(`https://${host}/avatar/0123456789abcdef`), host).toBeNull();
    }
    expect(publishablePhotoUrl("https://secure.gravatar.com/avatar/0123456789abcdef?s=200")).toBeNull();
  });
});

describe("publicName", () => {
  it("is the display name, else the account name, never both", () => {
    expect(publicName({ name: "Ada Legal", display_name: "Ada Example" }, null)).toBe("Ada Example");
    expect(publicName({ name: "Ada Legal", display_name: null }, null)).toBe("Ada Legal");
  });

  it("is the pen name when one is chosen", () => {
    expect(publicName({ name: "Ada Legal", display_name: "Ada Example" }, "A. E. Pen")).toBe("A. E. Pen");
    expect(publicName({ name: "Ada Legal", display_name: "Ada Example" }, "  ")).toBe("Ada Example");
  });
});

describe("isProfilePubliclyServable", () => {
  it("serves a page unless it was removed", () => {
    expect(isProfilePubliclyServable({ deletedAt: null, memberStatus: "active" })).toBe(true);
    expect(isProfilePubliclyServable({ deletedAt: "2027-01-01T00:00:00Z", memberStatus: "active" })).toBe(false);
  });

  it("does not yet decide anything on the member's status: that is the owner's open question", () => {
    for (const status of ["lead", "active", "on_hiatus", "cancelled"]) {
      expect(isProfilePubliclyServable({ deletedAt: null, memberStatus: status }), status).toBe(true);
    }
  });
});

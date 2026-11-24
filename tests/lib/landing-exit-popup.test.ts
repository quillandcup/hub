import { describe, expect, it } from "vitest";
import {
  DELAY_DEFAULT,
  DELAY_MAX,
  DELAY_MIN,
  REMEMBER_DEFAULT,
  REMEMBER_MAX,
  SUBMITTED_DAYS,
  describeExitPopup,
  hasSignInCookie,
  isExitIntent,
  CLOSED_KEY,
  SIGNED_UP_KEY,
  addClosure,
  addSignUp,
  isQuiet,
  normalizeFormIds,
  normalizePopupName,
  popupKey,
  withPopupFormIds,
  isSuppressed,
  parseClosures,
  parseSignedUp,
  mayRemember,
  normalizeExitPopup,
  parseDismissal,
  planTriggers,
  popupStorageKey,
  publicSlugOf,
  serializeDismissal,
  type ExitPopupSettings,
} from "@/lib/landing/exit-popup";

const DAY = 24 * 60 * 60 * 1000;
const on = (extra: Record<string, unknown> = {}): ExitPopupSettings => normalizeExitPopup({ enabled: true, ...extra });
const desktop = { mobile: false, finePointer: true };
const phone = { mobile: true, finePointer: false };

describe("normalizeExitPopup", () => {
  it("is off, with the defaults, for a block with nothing set", () => {
    expect(normalizeExitPopup({})).toEqual({
      enabled: false,
      trigger: "either",
      delaySeconds: DELAY_DEFAULT,
      rememberDays: REMEMBER_DEFAULT,
      popupName: "",
      closeOnOverlay: true,
      hideOnDesktop: false,
      hideOnMobile: false,
      label: "",
    });
  });

  it("switches on only for exactly true, and takes the other switches only when they say so", () => {
    expect(normalizeExitPopup({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeExitPopup({ enabled: true }).enabled).toBe(true);
    expect(normalizeExitPopup({ closeOnOverlay: false }).closeOnOverlay).toBe(false);
    expect(normalizeExitPopup({ closeOnOverlay: "no" }).closeOnOverlay).toBe(true);
    expect(normalizeExitPopup({ hideOnMobile: 1 }).hideOnMobile).toBe(false);
  });

  it("clamps the seconds and the days to what is allowed, and falls back for nonsense", () => {
    expect(normalizeExitPopup({ delaySeconds: 0 }).delaySeconds).toBe(DELAY_MIN);
    expect(normalizeExitPopup({ delaySeconds: 99999 }).delaySeconds).toBe(DELAY_MAX);
    expect(normalizeExitPopup({ delaySeconds: "30" }).delaySeconds).toBe(30);
    expect(normalizeExitPopup({ delaySeconds: 4.6 }).delaySeconds).toBe(5);
    expect(normalizeExitPopup({ delaySeconds: "soon" }).delaySeconds).toBe(DELAY_DEFAULT);
    expect(normalizeExitPopup({ delaySeconds: null }).delaySeconds).toBe(DELAY_DEFAULT);
    expect(normalizeExitPopup({ rememberDays: -3 }).rememberDays).toBe(0);
    expect(normalizeExitPopup({ rememberDays: 0 }).rememberDays).toBe(0);
    expect(normalizeExitPopup({ rememberDays: 100000 }).rememberDays).toBe(REMEMBER_MAX);
    expect(normalizeExitPopup({}).rememberDays).toBe(REMEMBER_DEFAULT);
  });

  it("knows three triggers and takes either for any other value", () => {
    expect(normalizeExitPopup({ trigger: "exit" }).trigger).toBe("exit");
    expect(normalizeExitPopup({ trigger: "time" }).trigger).toBe("time");
    expect(normalizeExitPopup({ trigger: "scroll" }).trigger).toBe("either");
  });

  it("trims the name and keeps it short", () => {
    expect(normalizeExitPopup({ label: "  Join the list  " }).label).toBe("Join the list");
    expect(normalizeExitPopup({ label: "x".repeat(500) }).label).toHaveLength(120);
    expect(normalizeExitPopup({ label: 7 }).label).toBe("");
  });
});

describe("planTriggers", () => {
  it("watches for nothing while the popup is off", () => {
    expect(planTriggers(normalizeExitPopup({}), desktop)).toBeNull();
  });

  it("watches for both on a computer and for the time alone on a phone, for the default trigger", () => {
    expect(planTriggers(on(), desktop)).toEqual({ time: true, exit: true });
    expect(planTriggers(on(), phone)).toEqual({ time: true, exit: false });
  });

  it("never shows a popup set to exit intent alone on a device with no mouse", () => {
    expect(planTriggers(on({ trigger: "exit" }), desktop)).toEqual({ time: false, exit: true });
    expect(planTriggers(on({ trigger: "exit" }), phone)).toBeNull();
    expect(planTriggers(on({ trigger: "exit" }), { mobile: false, finePointer: false })).toBeNull();
  });

  it("uses the time alone when the trigger says so, whatever the device", () => {
    expect(planTriggers(on({ trigger: "time" }), desktop)).toEqual({ time: true, exit: false });
    expect(planTriggers(on({ trigger: "time" }), phone)).toEqual({ time: true, exit: false });
  });

  it("hides on the device it is told to hide on, and only there", () => {
    expect(planTriggers(on({ hideOnMobile: true }), phone)).toBeNull();
    expect(planTriggers(on({ hideOnMobile: true }), desktop)).not.toBeNull();
    expect(planTriggers(on({ hideOnDesktop: true }), desktop)).toBeNull();
    expect(planTriggers(on({ hideOnDesktop: true }), phone)).not.toBeNull();
  });
});

describe("isExitIntent", () => {
  it("is the mouse leaving the page through the top edge, and nothing else", () => {
    expect(isExitIntent({ clientY: 0, relatedTarget: null })).toBe(true);
    expect(isExitIntent({ clientY: -4, relatedTarget: null })).toBe(true);
    // Leaving through a side or the bottom, or moving between elements of the page.
    expect(isExitIntent({ clientY: 300, relatedTarget: null })).toBe(false);
    expect(isExitIntent({ clientY: 0, relatedTarget: {} })).toBe(false);
  });
});

describe("hasSignInCookie", () => {
  it("sees the sign-in cookie by its name, whole or in chunks, and nothing else", () => {
    expect(hasSignInCookie("sb-abcdefgh-auth-token=base64-xyz")).toBe(true);
    expect(hasSignInCookie("theme=dark; sb-abcdefgh-auth-token.0=aaa; sb-abcdefgh-auth-token.1=bbb")).toBe(true);
    expect(hasSignInCookie("")).toBe(false);
    expect(hasSignInCookie("theme=dark; _ga=GA1.1.123")).toBe(false);
    expect(hasSignInCookie("sb-abcdefgh-auth-token-code-verifier=zzz")).toBe(false);
    expect(hasSignInCookie("x-sb-abcdefgh-auth-token=nope")).toBe(false);
  });
});

describe("mayRemember", () => {
  it("keeps a record where nobody is asked, and elsewhere only after an Accept", () => {
    expect(mayRemember(false, null)).toBe(true);
    expect(mayRemember(false, "denied")).toBe(true);
    expect(mayRemember(true, null)).toBe(false);
    expect(mayRemember(true, "denied")).toBe(false);
    expect(mayRemember(true, "granted")).toBe(true);
  });
});

describe("the record of a closed popup", () => {
  it("round-trips, and reads nothing from anything that is not its own", () => {
    expect(parseDismissal(serializeDismissal({ at: 1700000000000, submitted: true }))).toEqual({ at: 1700000000000, submitted: true });
    expect(parseDismissal(serializeDismissal({ at: 5, submitted: false }))).toEqual({ at: 5, submitted: false });
    for (const raw of [null, "", "nope", "[]", "null", '{"at":"yesterday"}', '{"submitted":true}', '{"at":null}']) expect(parseDismissal(raw)).toBeNull();
  });

  it("keeps slice 1's per-page key, and the site-wide keys cannot collide with a page's", () => {
    expect(popupStorageKey("spring")).toBe("lp-popup:spring");
    expect(popupStorageKey("signed-up")).not.toBe(SIGNED_UP_KEY);
    expect(popupStorageKey("closed")).not.toBe(CLOSED_KEY);
  });

  it("reads the sign-up and close records, and drops anything that is not theirs", () => {
    expect([...parseSignedUp('{"form-a":5,"form-b":"x","form-c":null}')]).toEqual([["form-a", 5]]);
    expect([...parseClosures('{"name:news":{"at":5,"days":3},"page:a":{"at":5},"page:b":7,"page:c":null}')]).toEqual([["name:news", { at: 5, days: 3 }]]);
    for (const raw of [null, "", "nope", "[]", "null", "5"]) {
      expect(parseSignedUp(raw).size).toBe(0);
      expect(parseClosures(raw).size).toBe(0);
    }
  });

  const now = Date.UTC(2026, 10, 23, 15, 0, 0);

  it("keeps the popup away for the days it was told to, to the millisecond", () => {
    const record = { at: now - 3 * DAY, submitted: false };
    expect(isSuppressed(record, now, 7)).toBe(true);
    expect(isSuppressed(record, now, 3)).toBe(false);
    expect(isSuppressed({ at: now - 3 * DAY + 1, submitted: false }, now, 3)).toBe(true);
    expect(isSuppressed({ at: now - 7 * DAY, submitted: false }, now, 7)).toBe(false);
  });

  it("never holds a visitor off when the days are zero, or there is no record", () => {
    expect(isSuppressed({ at: now - 1000, submitted: false }, now, 0)).toBe(false);
    expect(isSuppressed(null, now, 7)).toBe(false);
  });

  it("lets a record dated in the future (a clock that was changed) go", () => {
    expect(isSuppressed({ at: now + DAY, submitted: false }, now, 7)).toBe(false);
  });

  it("leaves a visitor who signed up alone for a year, whatever the days say", () => {
    expect(isSuppressed({ at: now - 300 * DAY, submitted: true }, now, 0)).toBe(true);
    expect(isSuppressed({ at: now - 300 * DAY, submitted: true }, now, 1)).toBe(true);
    expect(isSuppressed({ at: now - (SUBMITTED_DAYS + 1) * DAY, submitted: true }, now, 7)).toBe(false);
  });
});

describe("publicSlugOf", () => {
  it("is the page's address on the public site, and null for the editor, the preview and everything else", () => {
    expect(publicSlugOf("/p/spring-sale")).toBe("spring-sale");
    expect(publicSlugOf("/p/spring-sale/")).toBe("spring-sale");
    expect(publicSlugOf("/admin/pages/spring-sale")).toBeNull();
    expect(publicSlugOf("/admin/pages/spring-sale/preview")).toBeNull();
    expect(publicSlugOf("/p/a/b")).toBeNull();
    expect(publicSlugOf("/")).toBeNull();
  });
});

describe("describeExitPopup", () => {
  it("says what the settings do, in words", () => {
    expect(describeExitPopup(on())).toBe(`Shows after ${DELAY_DEFAULT} seconds, or when a visitor on a computer goes to leave. Not shown again for ${REMEMBER_DEFAULT} days after it is closed.`);
    expect(describeExitPopup(on({ trigger: "exit", rememberDays: 1 }))).toBe("Shows when a visitor on a computer goes to leave (never on a phone). Not shown again for 1 day after it is closed.");
    expect(describeExitPopup(on({ trigger: "time", delaySeconds: 20, rememberDays: 0, hideOnMobile: true }))).toBe("Shows after 20 seconds. Hidden on mobile. Shows again on every visit.");
    expect(describeExitPopup(on({ trigger: "time", hideOnDesktop: true, hideOnMobile: true }))).toContain("Hidden on every device.");
    expect(describeExitPopup(on({ trigger: "time", hideOnDesktop: true }))).toContain("Hidden on desktop.");
  });
});

describe("a popup's name, key and forms", () => {
  it("compares names without regard to case, spacing or length", () => {
    expect(normalizePopupName("  Weekly   Newsletter ")).toBe("weekly newsletter");
    expect(normalizePopupName(7)).toBe("");
    expect(normalizePopupName("x".repeat(100))).toHaveLength(60);
  });

  it("remembers a close under the name when there is one, and under the page when there is not", () => {
    expect(popupKey("news", "spring")).toBe("name:news");
    expect(popupKey("", "spring")).toBe("page:spring");
    expect(popupKey("", "spring")).not.toBe(popupKey("", "autumn"));
  });

  it("takes only plain form ids", () => {
    expect(normalizeFormIds(["a-1", "a-1", "b_2", "bad id", 5, "", "x".repeat(65)])).toEqual(["a-1", "b_2"]);
    expect(normalizeFormIds("a")).toEqual([]);
  });

  it("gives each popup the ids of the forms inside it, however deep, and changes nothing else", () => {
    const form = (id: string) => ({ type: "OptInForm", props: { id: `o-${id}`, kajabiFormId: id } });
    const data = {
      content: [
        { type: "Section", props: { id: "s", content: [form("page-form"), { type: "Heading", props: { id: "h", text: "Hi" } }] } },
        { type: "ExitPopup", props: { id: "p", enabled: true, content: [{ type: "Heading", props: { id: "h2" } }, { type: "Section", props: { id: "s2", content: [form(" in-popup ")] } }] } },
        { type: "ExitPopup", props: { id: "q", content: [{ type: "Text", props: { id: "t" } }] } },
      ],
      root: { props: {} },
    };
    const before = JSON.stringify(data);
    const out = withPopupFormIds(data);
    expect(JSON.stringify(data)).toBe(before);
    expect(out.content[1].props).toMatchObject({ formIds: ["in-popup"] });
    expect(out.content[2].props).toMatchObject({ formIds: [] });
    expect(out.content[0].props).not.toHaveProperty("formIds");
    expect(withPopupFormIds(null)).toBeNull();
  });
});

describe("isQuiet: what each popup is told to remember", () => {
  const now = Date.UTC(2026, 10, 23, 15, 0, 0);
  const none = { signedUp: null, closed: null, legacyPage: null };
  const news = { key: popupKey("news", "spring"), formIds: ["form-a"] };
  const signedUp = (ago: number, id = "form-a") => JSON.stringify({ [id]: now - ago });
  const closed = (ago: number, days: number, key = news.key) => JSON.stringify({ [key]: { at: now - ago, days } });

  it("is not quiet with nothing remembered, or with records it cannot read", () => {
    expect(isQuiet(none, news, now, 7)).toBe(false);
    expect(isQuiet({ signedUp: "x", closed: "y", legacyPage: "z" }, news, now, 7)).toBe(false);
  });

  it("keeps a popup away for a year after a sign-up through a form it holds, whatever its own days", () => {
    expect(isQuiet({ ...none, signedUp: signedUp(300 * DAY) }, news, now, 0)).toBe(true);
    expect(isQuiet({ ...none, signedUp: signedUp((SUBMITTED_DAYS + 1) * DAY) }, news, now, 7)).toBe(false);
    expect(isQuiet({ ...none, signedUp: signedUp(-DAY) }, news, now, 7)).toBe(false);
  });

  it("does not let a sign-up through form A quiet a popup that holds form B, or one with no form", () => {
    const memory = { ...none, signedUp: signedUp(DAY, "form-a") };
    expect(isQuiet(memory, { key: "page:other", formIds: ["form-b"] }, now, 7)).toBe(false);
    expect(isQuiet(memory, { key: "page:other", formIds: [] }, now, 7)).toBe(false);
    expect(isQuiet(memory, { key: "page:other", formIds: ["form-b", "form-a"] }, now, 7)).toBe(true);
  });

  it("keeps a popup away for the days stored with its close, not its own", () => {
    expect(isQuiet({ ...none, closed: closed(2 * DAY, 3) }, news, now, 30)).toBe(true);
    expect(isQuiet({ ...none, closed: closed(3 * DAY, 3) }, news, now, 30)).toBe(false);
    expect(isQuiet({ ...none, closed: closed(DAY, 30) }, news, now, 1)).toBe(true);
  });

  it("shares a close between popups with one name, and not with another name or with an unnamed popup", () => {
    const memory = { ...none, closed: closed(DAY, 7, popupKey("news", "spring")) };
    expect(isQuiet(memory, { key: popupKey("news", "autumn"), formIds: [] }, now, 7)).toBe(true);
    expect(isQuiet(memory, { key: popupKey("sale", "autumn"), formIds: [] }, now, 7)).toBe(false);
    expect(isQuiet(memory, { key: popupKey("", "spring"), formIds: [] }, now, 7)).toBe(false);
  });

  it("keeps an unnamed popup's close to its own page", () => {
    const memory = { ...none, closed: closed(DAY, 7, popupKey("", "spring")) };
    expect(isQuiet(memory, { key: popupKey("", "spring"), formIds: [] }, now, 7)).toBe(true);
    expect(isQuiet(memory, { key: popupKey("", "autumn"), formIds: [] }, now, 7)).toBe(false);
  });

  it("treats a close of 0 days, or one dated in the future, as nothing", () => {
    expect(isQuiet({ ...none, closed: closed(1000, 0) }, news, now, 7)).toBe(false);
    expect(isQuiet({ ...none, closed: closed(-DAY, 7) }, news, now, 7)).toBe(false);
  });

  it("still honours a slice 1 per-page record, with this popup's days", () => {
    const old = (ago: number, submitted: boolean) => serializeDismissal({ at: now - ago, submitted });
    expect(isQuiet({ ...none, legacyPage: old(3 * DAY, false) }, news, now, 7)).toBe(true);
    expect(isQuiet({ ...none, legacyPage: old(3 * DAY, false) }, news, now, 0)).toBe(false);
    expect(isQuiet({ ...none, legacyPage: old(300 * DAY, true) }, news, now, 0)).toBe(true);
  });
});

describe("keeping the records", () => {
  const now = Date.UTC(2026, 10, 23, 15, 0, 0);

  it("adds a sign-up beside the others, replaces one through the same form, and lets a year-old one go", () => {
    const first = addSignUp(null, "form-a", now - 400 * DAY);
    const second = addSignUp(first, "form-b", now - DAY);
    const third = addSignUp(second, "form-b", now);
    expect([...parseSignedUp(third)]).toEqual([["form-b", now]]);
    const both = addSignUp(addSignUp(null, "form-a", now - DAY), "form-b", now);
    expect([...parseSignedUp(both).keys()].sort()).toEqual(["form-a", "form-b"]);
  });

  it("adds a close beside the others, lets a later close of the same popup replace it, and drops the ones that ended", () => {
    const old = addClosure(null, "name:old", { at: now - 10 * DAY, days: 7 }, now - 10 * DAY);
    const a = addClosure(old, "name:a", { at: now - 2 * DAY, days: 7 }, now - 2 * DAY);
    const b = addClosure(a, "name:b", { at: now, days: 3 }, now);
    expect([...parseClosures(b).keys()].sort()).toEqual(["name:a", "name:b"]);
    const again = addClosure(b, "name:a", { at: now, days: 1 }, now);
    expect(parseClosures(again).get("name:a")).toEqual({ at: now, days: 1 });
  });

  it("keeps the newest fifty", () => {
    let raw: string | null = null;
    for (let i = 0; i < 60; i++) raw = addSignUp(raw, `form-${i}`, now - (60 - i) * 1000);
    const kept = parseSignedUp(raw);
    expect(kept.size).toBe(50);
    expect(kept.has("form-59")).toBe(true);
    expect(kept.has("form-0")).toBe(false);
  });
});

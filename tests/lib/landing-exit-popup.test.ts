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
  isSuppressed,
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

  it("keeps its key per page", () => {
    expect(popupStorageKey("spring")).toBe("lp-popup:spring");
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

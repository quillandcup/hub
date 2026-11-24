import { describe, expect, it } from "vitest";
import { BLOCK_DEFAULTS, SLOTS } from "@/components/landing/config";
import { checkLandingPage } from "@/lib/landing/a11y";
import { collectAssetIds, normalizeLandingData } from "@/lib/landing/data";
import { sanitizeLandingData } from "@/lib/landing/sanitize";

const heading = (text: string, level = "h1") => ({ type: "Heading", props: { id: `h-${text}`, text, level, align: "center" } });
const popup = (props: Record<string, unknown> = {}, content: unknown[] = [heading("Before you go", "h2"), { type: "RichText", props: { id: "t", html: "<p>Join us.</p>", align: "center" } }]) => ({
  type: "ExitPopup",
  props: { id: `p${Math.random()}`, enabled: true, label: "Join the newsletter", content, ...props },
});
const page = (...blocks: unknown[]) => ({ content: [heading("The page"), ...blocks], root: {} });
const messages = (data: unknown) => checkLandingPage(data).map((i) => `${i.severity}: ${i.block}: ${i.message}`);

describe("the Exit popup block", () => {
  it("is registered with a slot for its blocks and starts switched off, with a heading, a line and a sign-up form to change", () => {
    expect(SLOTS.ExitPopup).toEqual(["content"]);
    expect(BLOCK_DEFAULTS.ExitPopup.enabled).toBe(false);
    expect(BLOCK_DEFAULTS.ExitPopup.content.map((b: { type: string }) => b.type)).toEqual(["Heading", "RichText", "OptInForm"]);
  });
});

describe("publish check for the Exit popup", () => {
  it("passes a popup with something in it and a name", () => {
    expect(checkLandingPage(page(popup()))).toEqual([]);
  });

  it("does not count a popup as page content: a page with only a popup is empty", () => {
    const only = { content: [popup()], root: {} };
    expect(checkLandingPage(only).map((i) => i.message)).toContain("The page is empty.");
  });

  it("stops the publish of a popup that is on and has nothing in it", () => {
    const issues = checkLandingPage(page(popup({}, [])));
    expect(issues).toContainEqual({ severity: "error", block: "Exit popup", message: expect.stringContaining("has nothing in it") });
  });

  it("warns about a popup with no name for screen readers", () => {
    expect(messages(page(popup({ label: " " })))).toEqual([expect.stringContaining("warning: Exit popup: Give the exit popup a name")]);
  });

  it("does not look inside a popup that is switched off (it starts with a sign-up form with no Kajabi form), nor complain about it being empty", () => {
    const off = popup({ enabled: false, label: "" }, [{ type: "OptInForm", props: { id: "o", kajabiFormId: "", buttonLabel: "Join" } }]);
    expect(checkLandingPage(page(off))).toEqual([]);
  });

  it("checks what is inside a popup that is on, like anything else (a sign-up form with no Kajabi form, a button with no link)", () => {
    const issues = checkLandingPage(
      page(popup({}, [{ type: "OptInForm", props: { id: "o", kajabiFormId: "", buttonLabel: "Join" } }, { type: "Button", props: { id: "b", label: "Read more first", href: "" } }])),
    );
    expect(issues.filter((i) => i.severity === "error").map((i) => i.block)).toEqual(["Sign-up form", "Button"]);
  });

  it("keeps the popup's headings out of the page's outline: an h2 over a skipped level is not a skip, and a page title in the popup is a warning, not a second title", () => {
    const skipped = popup({}, [heading("Deep", "h3")]);
    expect(messages(page(skipped))).toEqual([]);
    const second = messages(page(popup({}, [heading("Another title", "h1")])));
    expect(second).toEqual([expect.stringContaining('warning: Exit popup: "Another title" is a page title (h1) inside the popup')]);
    expect(second.join()).not.toContain("more than one page title");
  });

  it("allows one popup that is on; a second that is on is an error, and one that is off is not", () => {
    expect(messages(page(popup(), popup({ enabled: false })))).toEqual([]);
    expect(messages(page(popup(), popup()))).toEqual([expect.stringContaining("error: Exit popup: The page has 2 exit popups switched on")]);
  });
});

describe("what a popup carries through the rest of the page's machinery", () => {
  const data = page(
    popup({}, [
      { type: "Image", props: { id: "i", imageAssetId: "ast_popup", alt: "A cup", decorative: false } },
      { type: "RichText", props: { id: "t", html: '<p onclick="x()">Hi <a href="javascript:alert(1)">there</a></p><script>x()</script>', align: "left" } },
      { type: "Button", props: { id: "b", label: "Read", href: "javascript:alert(1)" } },
    ]),
  );

  it("collects the pictures inside it, so publishing makes them public", () => {
    expect(collectAssetIds(normalizeLandingData(data))).toEqual(["ast_popup"]);
  });

  it("cleans the words and the links inside it before a visitor sees them", () => {
    const clean = JSON.stringify(sanitizeLandingData(data));
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("<script");
    expect(clean).toContain("Hi ");
  });
});

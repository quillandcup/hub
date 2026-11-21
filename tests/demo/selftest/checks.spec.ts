import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";
import { TALL_VIEWPORT_CAP, captureWholePage, pageFindings, scrollThroughPage, tallestViewport } from "../checks";

/**
 * The page checks themselves, against small pages built here: each problem they claim to catch is shown to be
 * caught, and a clean page is shown to be clean. Without this a check that quietly stopped working would look
 * exactly like an app with no problems. Runs at every size and colour scheme like the scenes do.
 */
const page = (body: string, head = "") => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title><style>body{margin:0;font:16px sans-serif;background:#fff;color:#111}${head}</style></head><body><main>${body}</main></body></html>`;
const kinds = (findings: { key: string }[]) => findings.map((f) => f.key.split(":").slice(0, 2).join(":"));

test("a clean page has no findings", async ({ page: p }) => {
  await p.setContent(page("<h1>Hello</h1><p>Plain text.</p>"));
  expect(await pageFindings(p)).toEqual([]);
});

test("text with too little contrast is an a11y finding", async ({ page: p }) => {
  await p.setContent(page('<p style="color:#bbb">pale grey on white</p>'));
  expect(kinds(await pageFindings(p))).toContain("a11y:color-contrast");
});

test("a select with no name is an a11y finding", async ({ page: p }) => {
  await p.setContent(page("<select><option>a</option></select>"));
  expect(kinds(await pageFindings(p))).toContain("a11y:select-name");
});

test("a page that scrolls sideways, and the element that makes it, are found", async ({ page: p }) => {
  await p.setContent(page('<div style="width:3000px;height:20px;background:#ccc" id="wide"></div>'));
  expect(kinds(await pageFindings(p))).toEqual(expect.arrayContaining(["overflow:page-scrolls-sideways", "overflow:sticks-out"]));
});

test("something wide inside a container meant to scroll is fine", async ({ page: p }) => {
  await p.setContent(page('<div style="overflow-x:auto;width:200px"><div style="width:3000px;height:10px;background:#ccc"></div></div>'));
  expect(kinds(await pageFindings(p)).filter((k) => k.startsWith("overflow"))).toEqual([]);
});

test("a dialog cut off by the screen edge is found", async ({ page: p }) => {
  await p.setContent(page('<div role="dialog" aria-label="Cut off" style="position:fixed;top:10px;left:-60px;width:300px;height:100px;background:#eee">x</div>'));
  expect(kinds(await pageFindings(p))).toContain("edge:dialog-cut-off");
});

test("a dialog taller than the screen with no scrolling of its own is found, one that scrolls is not", async ({ page: p }) => {
  const tall = (overflow: string) => `<div role="dialog" aria-label="Tall" style="position:fixed;top:5px;left:16px;right:16px;height:4000px;overflow-y:${overflow};background:#eee"><div style="height:6000px">x</div></div>`;
  await p.setContent(page(tall("visible")));
  expect(kinds(await pageFindings(p))).toContain("edge:dialog-too-tall");
  await p.setContent(page(tall("auto").replace("height:4000px", "max-height:300px")));
  expect(kinds(await pageFindings(p))).not.toContain("edge:dialog-too-tall");
});

test("a dialog too close to the side is found, with a margin or edge to edge it is not", async ({ page: p }) => {
  const dialog = (style: string) => `<div role="dialog" aria-label="Near" style="position:fixed;top:20px;height:80px;background:#eee;${style}">x</div>`;
  await p.setContent(page(dialog("left:2px;width:200px")));
  expect(kinds(await pageFindings(p))).toContain("edge:dialog-near-edge");
  await p.setContent(page(dialog("left:16px;width:200px")));
  expect(kinds(await pageFindings(p))).not.toContain("edge:dialog-near-edge");
  await p.setContent(page(dialog("left:0;right:0")));
  expect(kinds(await pageFindings(p))).not.toContain("edge:dialog-near-edge");
});

// The member app is a full-height shell whose `main` scrolls; the window itself never does. These pages are that shape.
const shell = (inner: string, extra = "") =>
  page(`<div style="height:100vh;overflow:hidden;position:relative"><main style="height:100%;overflow:auto">${inner}</main>${extra}</div>`);

test("scrolling through loads content that appears only when scrolled to, in an inner scrolling area", async ({ page: p }) => {
  await p.setContent(
    shell('<div style="height:3000px"></div><div id="lazy">far below</div>') +
      '<script>new IntersectionObserver((e)=>{if(e[0].isIntersecting)document.getElementById("lazy").textContent="loaded"}).observe(document.getElementById("lazy"))</script>',
  );
  expect(await p.locator("#lazy").textContent()).toBe("far below");
  await scrollThroughPage(p);
  expect(await p.locator("#lazy").textContent()).toBe("loaded");
  expect(await p.evaluate(() => document.querySelector("main")!.scrollTop)).toBe(0);
});

test("a whole-page capture grows the viewport to fit an inner scrolling area, then puts it back", async ({ page: p }, testInfo) => {
  const before = p.viewportSize()!;
  await p.setContent(shell('<div style="height:3000px;background:linear-gradient(#fff,#bbb)"></div>'));
  expect(await p.evaluate(tallestViewport, TALL_VIEWPORT_CAP)).toBeGreaterThanOrEqual(3000);

  const file = testInfo.outputPath("whole-page.png");
  await captureWholePage(p, file);
  expect(p.viewportSize()).toEqual(before);
  const pixelHeight = readFileSync(file).readUInt32BE(20); // a PNG's height, from its header
  const scale = await p.evaluate(() => window.devicePixelRatio);
  expect(pixelHeight).toBeGreaterThanOrEqual(Math.round(3000 * scale));
});

test("a very long page is cut at the cap, not stretched without limit", async ({ page: p }) => {
  await p.setContent(shell('<div style="height:50000px"></div>'));
  expect(await p.evaluate(tallestViewport, TALL_VIEWPORT_CAP)).toBe(TALL_VIEWPORT_CAP);
});

test("a page that fits the screen is captured as it is", async ({ page: p }, testInfo) => {
  const before = p.viewportSize()!;
  await p.setContent(page("<h1>Short</h1>"));
  await captureWholePage(p, testInfo.outputPath("short.png"));
  expect(p.viewportSize()).toEqual(before);
});

const BUTTONS = Array.from({ length: 40 }, (_, i) => `<button style="display:block;height:40px;margin:8px 0">Item ${i}</button>`).join("");
const BAR = '<div role="contentinfo" style="position:fixed;left:0;right:0;bottom:0;height:90px;background:#ddd">bar</div>';
const BAR_IN_SHELL = '<div role="contentinfo" style="position:absolute;left:0;right:0;bottom:0;height:90px;background:#ddd">bar</div>';

test("a control still under a fixed bar at the end of the page is found; room for it clears it", async ({ page: p }) => {
  await p.setContent(page(`${BUTTONS}${BAR}`));
  expect(kinds(await pageFindings(p))).toContain("edge:control-covered");
  await p.setContent(page(`<div style="padding-bottom:120px">${BUTTONS}</div>${BAR}`));
  expect(kinds(await pageFindings(p))).not.toContain("edge:control-covered");
});

test("the same, when the page scrolls inside a shell", async ({ page: p }) => {
  await p.setContent(shell(BUTTONS, BAR_IN_SHELL));
  expect(kinds(await pageFindings(p))).toContain("edge:control-covered");
  await p.setContent(shell(`<div style="padding-bottom:120px">${BUTTONS}</div>`, BAR_IN_SHELL));
  expect(kinds(await pageFindings(p))).not.toContain("edge:control-covered");
});

test("a control under a fixed bar at the top of the page is found", async ({ page: p }) => {
  await p.setContent(page(`<button style="margin-top:10px">First</button><div style="height:400px"></div><div role="banner" style="position:fixed;top:0;left:0;right:0;height:80px;background:#ddd">header</div>`));
  expect(kinds(await pageFindings(p))).toContain("edge:control-covered");
});

test("content passing under a fixed bar while scrolling is not a finding; an open dialog over the page isn't either", async ({ page: p }) => {
  await p.setContent(page(`<div style="padding:100px 0 120px">${BUTTONS}</div>${BAR}`));
  expect(kinds(await pageFindings(p))).not.toContain("edge:control-covered");
  await p.setContent(page(`${BUTTONS}<div role="dialog" aria-modal="true" aria-label="Open" style="position:fixed;inset:16px;background:#eee">dialog</div>`));
  expect(kinds(await pageFindings(p))).not.toContain("edge:control-covered");
});

test("a control inside a closed disclosure is not covered, because it is not there; open, it is checked like any other", async ({ page: p }) => {
  // Closed, its links keep a layout box the browser still reports, which sits under whatever follows the disclosure.
  const list = '<ul><li><a href="#a">One</a></li><li><a href="#b">Two</a></li></ul>';
  const article = '<article style="position:relative;z-index:2;background:#eee;height:300px"><button>Next</button></article>';
  await p.setContent(page(`<details><summary>Lessons</summary>${list}</details>${article}`));
  expect(kinds(await pageFindings(p))).not.toContain("edge:control-covered");
  await p.setContent(page(`<details open><summary>Lessons</summary>${list}</details>${article}`));
  expect(kinds(await pageFindings(p))).not.toContain("edge:control-covered");
});

// A wide grid in a card, inside a scroller: the shape of the week calendar.
const GRID = '<div style="display:grid;grid-template-columns:repeat(7,280px);width:1960px;height:60px;background:#ddd"><div>S</div><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div></div>';

test("a wide grid clipped by its card, with the scroller outside the clip, is found: nothing can reach the rest", async ({ page: p }) => {
  await p.setContent(page(`<div style="overflow:auto"><div style="container-type:inline-size;overflow:clip">${GRID}</div></div>`));
  expect(kinds(await pageFindings(p))).toContain("overflow:sticks-out");
});

test("the same grid hidden by an overflow:hidden box is found too", async ({ page: p }) => {
  await p.setContent(page(`<div style="overflow:hidden">${GRID}</div>`));
  expect(kinds(await pageFindings(p))).toContain("overflow:sticks-out");
});

test("a wide grid in a container that really scrolls sideways is fine, and every column can be scrolled into view", async ({ page: p }) => {
  await p.setContent(page(`<div id="scroller" style="overflow:auto"><div style="container-type:inline-size"><div style="min-width:1960px">${GRID}</div></div></div>`));
  expect(kinds(await pageFindings(p)).filter((k) => k.startsWith("overflow"))).toEqual([]);
  expect(await p.evaluate(() => { const s = document.getElementById("scroller")!; return s.scrollWidth > s.clientWidth; })).toBe(true);
});

test("a slide-in drawer, closed or mid-slide, is not something sticking out of the page", async ({ page: p }) => {
  const drawer = (x: string) => `<aside style="position:fixed;top:0;bottom:0;left:0;width:256px;transform:translateX(${x});background:#eee"><nav style="padding:16px"><a href="/x">Link</a></nav></aside>`;
  await p.setContent(page(`<p>Page</p>${drawer("-100%")}`));
  expect(kinds(await pageFindings(p)).filter((k) => k.startsWith("overflow"))).toEqual([]);
  await p.setContent(page(`<p>Page</p>${drawer("-50%")}`));
  expect(kinds(await pageFindings(p)).filter((k) => k.startsWith("overflow"))).toEqual([]);
});

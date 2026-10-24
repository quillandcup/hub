import { expect, test } from "playwright/test";
import { pageFindings } from "../checks";

/**
 * The page checks themselves, against small pages built here: each problem they claim to catch is shown to be
 * caught, and a clean page is shown to be clean. Without this a check that quietly stopped working would look
 * exactly like an app with no problems. Runs at every size and colour scheme like the scenes do.
 */
const page = (body: string, head = "") => `<!doctype html><html lang="en"><head><title>t</title><style>body{margin:0;font:16px sans-serif;background:#fff;color:#111}${head}</style></head><body><main>${body}</main></body></html>`;
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

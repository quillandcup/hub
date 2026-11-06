import { expect, shot, test } from "../../fixtures";
import { linkPreviewPage } from "../../mockups/rest-frames";

/**
 * Screenshot for the changelog entry "Cleaner previews for Hub links". A MOCKUP frame of Slack's link card
 * (demo/mockups/rest-frames.tsx) filled from what the running app really serves: the page's Open Graph tags, with
 * the HTML entities decoded as a link-preview reader does, and the real og:image file. Not a page of the app, so the
 * page checks are off.
 */
test("a Hub link shared in Slack @changelog", async ({ page, request }, testInfo) => {
  const html = await (await request.get("/login")).text();
  const tag = (property: string) => html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1];
  const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  const title = tag("og:title");
  const description = tag("og:description");
  const imageUrl = tag("og:image");
  expect(title && description && imageUrl, "the login page has Open Graph tags").toBeTruthy();
  expect(tag("og:image:width")).toBe("1200");
  expect(tag("og:image:height")).toBe("630");

  // The image as the app serves it, inlined so the frame needs no network.
  const imageAddress = new URL(imageUrl!);
  const image = await request.get(imageAddress.pathname + imageAddress.search);
  expect(image.ok()).toBe(true);
  const dataUri = `data:${image.headers()["content-type"]};base64,${(await image.body()).toString("base64")}`;

  await page.setContent(
    linkPreviewPage({ url: "https://hub.example.com/login", title: decode(title!), description: decode(description!), image: dataUri }, "Maya Example"),
  );
  await expect(page.locator("[data-frame]")).toBeVisible();
  await shot(page, testInfo, "slack-link-preview", { element: page.locator("[data-frame]"), checks: false });
});

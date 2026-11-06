import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Message } from "slack-blocks-to-jsx";
import type { KnownBlock } from "@slack/web-api";

/**
 * Two more frames for the changelog screenshots (the notification frames are in frames.tsx): the Slack Home tab the
 * sign-in button lives on, drawn from the real `buildSlackSignInBlocks()` blocks, and the card Slack draws under a
 * shared link, drawn from the page's real Open Graph tags. Like the others, they show the content faithfully and the
 * surroundings plausibly; they are not pixel-identical to Slack.
 */
const SLACK_CSS = readFileSync(path.join(process.cwd(), "node_modules", "slack-blocks-to-jsx", "dist", "style.css"), "utf8");
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (css: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Slack</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;font-family:${FONT};background:#e9ecf1}${css}</style></head><body>${body}</body></html>`;

/** The bot's name and avatar as the Slack app manifest declares them (the frames in frames.tsx do the same). */
export function botIdentity(): { name: string; logo: string } {
  const manifest = readFileSync("slack-app-manifest.yml", "utf8");
  const name = (manifest.match(/^\s*display_name:\s*(.+)$/m)?.[1] ?? "Bot").trim();
  const color = manifest.match(/^\s*background_color:\s*"?(#[0-9a-fA-F]{6})"?/m)?.[1] ?? "#4A154B";
  const logo = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="10" fill="${color}"/><text x="36" y="50" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="700" text-anchor="middle" fill="#fff">${name.slice(0, 1)}</text></svg>`)}`;
  return { name, logo };
}

/** The app's Home tab in Slack, as it shows the sign-in blocks. */
export function slackHomePage(blocks: KnownBlock[], appName: string, logo: string): string {
  const css = `${SLACK_CSS}
  [data-frame]{width:720px;border:1px solid #ddd;border-radius:10px;overflow:hidden;background:#fff;color:#1d1c1d}
  .hd{display:flex;align-items:center;gap:10px;padding:10px 20px;background:#f8f8f8;border-bottom:1px solid #ddd;font-weight:700}
  .tabs{display:flex;gap:18px;padding:0 20px;border-bottom:1px solid #ddd;font-size:14px}
  .tabs span{padding:10px 0;color:#616061}.tabs .on{color:#1d1c1d;font-weight:700;border-bottom:3px solid #4a154b}
  .pane{padding:18px 20px 24px}`;
  const message = renderToStaticMarkup(<Message blocks={blocks as unknown as React.ComponentProps<typeof Message>["blocks"]} name={appName} logo={logo} time={new Date("2026-10-24T14:42:00Z")} theme="light" />);
  return page(css, `<div data-frame><div class="hd">${esc(appName)}</div><div class="tabs"><span class="on">Home</span><span>Messages</span><span>About</span></div><div class="pane">${message}</div></div>`);
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
}

/** A shared link as Slack draws it: the link in the message, then the card with the site, title, description and the large image. */
export function linkPreviewPage(preview: LinkPreview, senderName: string): string {
  const css = `
  [data-frame]{width:720px;border:1px solid #ddd;border-radius:10px;overflow:hidden;background:#fff;color:#1d1c1d;padding:18px 20px 24px}
  .who{font-weight:700;font-size:15px}.who small{font-weight:400;color:#616061;margin-left:6px}
  .link{color:#1264a3;font-size:15px;margin:4px 0 8px;word-break:break-all}
  .card{border-left:4px solid #dddddd;padding-left:12px;max-width:520px}
  .site{font-size:13px;font-weight:700;margin-bottom:2px}.t{font-size:15px;font-weight:700;color:#1264a3;margin-bottom:2px}
  .d{font-size:15px;line-height:1.4;margin-bottom:8px}.card img{display:block;width:100%;border-radius:8px}`;
  const host = new URL(preview.url).host;
  return page(
    css,
    `<div data-frame><div class="who">${esc(senderName)}<small>10:42</small></div><div class="link">${esc(preview.url)}</div><div class="card"><div class="site">${esc(host)}</div><div class="t">${esc(preview.title)}</div><div class="d">${esc(preview.description)}</div><img src="${esc(preview.image)}" alt=""></div></div>`,
  );
}

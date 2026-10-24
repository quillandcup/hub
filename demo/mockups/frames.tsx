import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Message } from "slack-blocks-to-jsx";
import { APP_URL, EMAIL_FROM } from "@/lib/config";
import { slackBlocks } from "@/lib/channels/slack";
import { pushPayload } from "@/lib/channels/web-push";
import { renderNotificationEmail } from "@/emails/notifications";
import { unsubscribePageUrl } from "@/lib/email-unsubscribe";
import { notificationKind, type NotificationKindId } from "@/lib/notifications/registry";
import type { OutboundMessage } from "@/lib/channels/types";
import appConfig from "../../app.config";

/**
 * What members receive, drawn from the app's own message code: the Slack blocks as `slackBlocks()` assembles
 * them (rendered by slack-blocks-to-jsx), the email as `renderNotificationEmail()` makes it, and the push as
 * `pushPayload()` builds it. Nothing about the content is retyped here; only the frames around it (a Slack
 * window, an email client, three kinds of device) are drawn. A frame is not pixel-identical to the real client:
 * it shows the content faithfully and the surroundings plausibly. See docs/DEMO_AND_HELP.md.
 *
 * Each function returns a full HTML page with one `[data-frame]` element, which the scene screenshots.
 */
export type Theme = "light" | "dark";

// The library formats the message time in this process's zone; pin it to the org's so "10:42" is 10:42 everywhere.
process.env.TZ = appConfig.orgTimezone;

const BOT_NAME = (readFileSync("slack-app-manifest.yml", "utf8").match(/^\s*display_name:\s*(.+)$/m)?.[1] ?? appConfig.appName).trim();
const BOT_COLOR = (readFileSync("slack-app-manifest.yml", "utf8").match(/^\s*background_color:\s*"?(#[0-9a-fA-F]{6})"?/m)?.[1] ?? "#4A154B");
// The bot's avatar as Slack shows an app without an uploaded icon: its initial on its brand colour.
const BOT_LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="10" fill="${BOT_COLOR}"/><text x="36" y="50" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="700" text-anchor="middle" fill="#fff">${BOT_NAME.slice(0, 1)}</text></svg>`)}`;
const SLACK_CSS = readFileSync(path.join(process.cwd(), "node_modules", "slack-blocks-to-jsx", "dist", "style.css"), "utf8");
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

const page = (title: string, css: string, body: string, theme: Theme) =>
  `<!doctype html><html lang="en" class="${theme}"><head><meta charset="utf-8"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;font-family:${FONT};background:${theme === "dark" ? "#0b0d11" : "#e9ecf1"}}${css}</style></head><body>${body}</body></html>`;

/** The last Slack message in a direct message with the bot, at 10:42 on a stated day, as a member would see it. */
export function slackPage(message: OutboundMessage, theme: Theme): string {
  const blocks = slackBlocks(message);
  const palette = theme === "dark" ? { bg: "#1a1d21", header: "#222529", line: "#383b40", text: "#d1d2d3", muted: "#ababad" } : { bg: "#ffffff", header: "#f8f8f8", line: "#dddddd", text: "#1d1c1d", muted: "#616061" };
  const css = `${SLACK_CSS}
  [data-frame]{width:720px;border:1px solid ${palette.line};border-radius:10px;overflow:hidden;background:${palette.bg};color:${palette.text}}
  .hd{display:flex;align-items:center;gap:10px;padding:12px 20px;background:${palette.header};border-bottom:1px solid ${palette.line};font-weight:700}
  .hd small{font-weight:400;color:${palette.muted}}
  .pane{padding:18px 20px 24px}`;
  const body = `<div data-frame><div class="hd">${BOT_NAME}<small>Direct message</small></div><div class="pane">${renderToStaticMarkup(
    <Message blocks={blocks} name={BOT_NAME} logo={BOT_LOGO} time={new Date("2026-10-24T14:42:00Z")} theme={theme} />,
  )}</div></div>`;
  return page("Slack", css, body, theme);
}

/** An email client around the rendered email, with its subject, sender and unsubscribe link as the real send has them. */
export async function emailPage(kind: NotificationEmailKind, message: OutboundMessage): Promise<string> {
  const unsubscribe = { label: `Unsubscribe from “${notificationKind(kind).label}” emails`, url: unsubscribePageUrl("sample-token") };
  const { subject, html } = await renderNotificationEmail(kind, { ...message, footerLinks: [...(message.footerLinks ?? []), unsubscribe] });
  const css = `[data-frame]{width:720px;background:#fff;border:1px solid #cfd4dc;border-radius:10px;overflow:hidden;color:#1f2933}
  .top{padding:16px 22px;border-bottom:1px solid #e3e7ed;background:#f6f8fa}.top h1{margin:0 0 8px;font-size:18px}.top p{margin:2px 0;font-size:13px;color:#52606d}
  iframe{display:block;width:100%;height:560px;border:0}`;
  const body = `<div data-frame><div class="top"><h1>${escapeHtml(subject)}</h1><p><b>From</b> ${escapeHtml(EMAIL_FROM)}</p><p><b>To</b> you</p></div><iframe srcdoc="${escapeAttr(html)}" title="Email"></iframe></div>`;
  return page("Email", css, body, "light");
}

export type PushDevice = "desktop" | "android" | "iphone";

/** A web push notification on a laptop, an Android phone and an iPhone (where it works for the Hub added to the Home Screen). */
export function pushPage(message: OutboundMessage, kind: NotificationKindId, device: PushDevice, theme: Theme): string {
  const p = pushPayload(message, { kind, memberId: "sample" }, Date.now());
  const dark = theme === "dark";
  const card = (extra: string) => `<div class="card" style="${extra}"><div class="icon">${escapeHtml(appConfig.appName.slice(0, 1))}</div><div class="txt"><div class="app">${escapeHtml(appConfig.appName)} · now</div><div class="title">${escapeHtml(p.title)}</div><div class="bodytext">${escapeHtml(p.body)}</div></div></div>`;
  const css = `.card{display:flex;gap:12px;padding:14px 16px;border-radius:16px;${dark ? "background:rgba(44,46,52,.96);color:#f2f3f5" : "background:rgba(255,255,255,.96);color:#1c1c1e"};box-shadow:0 6px 24px rgba(0,0,0,.25)}
  .icon{flex:none;width:40px;height:40px;border-radius:9px;background:#a64d79;color:#fff;font:700 20px/40px ${FONT};text-align:center}
  .app{font-size:12px;opacity:.65;margin-bottom:2px}.title{font-weight:600;font-size:15px}.bodytext{font-size:14px;opacity:.9;margin-top:2px;overflow-wrap:anywhere}
  [data-frame]{position:relative;overflow:hidden;border-radius:${device === "desktop" ? "10px" : "36px"};background:${dark ? "linear-gradient(160deg,#20243a,#0d0f1a)" : "linear-gradient(160deg,#b9c8f0,#e8d3ee)"};padding:${device === "desktop" ? "22px 22px 80px" : "70px 14px 150px"};width:${device === "desktop" ? "560px" : "380px"}}
  .clock{color:#fff;text-align:center;font:200 64px/1 ${FONT};margin:0 0 26px}.tag{position:absolute;bottom:12px;left:0;right:0;text-align:center;color:#fff;opacity:.7;font-size:12px}`;
  const tag = { desktop: "Browser notification on a computer", android: "Android phone", iphone: "iPhone: the Hub added to the Home Screen" }[device];
  const body = `<div data-frame>${device === "desktop" ? "" : `<div class="clock">10:42</div>`}${card("")}<div class="tag">${tag}</div></div>`;
  return page("Push", css, body, theme);
}

type NotificationEmailKind = NotificationKindId;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
export const appUrl = APP_URL;

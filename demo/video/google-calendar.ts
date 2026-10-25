import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { appConfig } from "../../app.config";

/**
 * The "your Prickles show up in Google Calendar" frames. The demo's feed isn't reachable from Google (it is
 * localhost), so the long video shows what Google does with it: the feed's .ics imported into a throwaway calendar,
 * with every other calendar hidden, captured as two screenshots in demo/out/video/google-calendar/ (gitignored: they
 * come from a real account, so they are made by hand and never committed):
 *
 *   week.jpg   the week view with only the imported calendar showing
 *   event.jpg  the same screen with one of the Prickles opened
 *
 * Both are 1400x845 browser screenshots. What would identify the account is left out or replaced: the sidebar and
 * header are cropped away, and the popover's calendar owner and the localhost link are covered with demo text.
 * Without the files the long video simply skips this segment. How to make them: docs/DEMO_AND_HELP.md, "Overview videos".
 */
const DIR = path.join("demo", "out", "video", "google-calendar");
const SURFACE = "#f1f4f9";

function dataUrl(file: string): string {
  return `data:image/jpeg;base64,${readFileSync(path.join(DIR, file)).toString("base64")}`;
}

const PAGE_STYLE = `
  html, body { margin: 0; height: 100%; background: radial-gradient(circle at 30% 20%, #8a3a67, #3a1b33 70%); overflow: hidden; }
  .stage { position: absolute; left: 50%; top: 28px; width: 1185px; height: 795px; transform: translateX(-50%) scale(.86); transform-origin: top center;
    border-radius: 18px; overflow: hidden; background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
  .shot { position: absolute; left: -165px; top: -40px; width: 1400px; height: 845px; }
  .dim { position: absolute; inset: 0; background: rgba(20, 10, 30, .45); }
  .pop { position: absolute; left: 317px; top: 150px; width: 324px; height: 280px; overflow: hidden; border-radius: 16px; box-shadow: 0 8px 28px rgba(0,0,0,.45); transform: scale(1.7); transform-origin: top left; }
  .pop img { position: absolute; left: -72px; top: -283px; width: 1400px; height: 845px; }
  .patch { position: absolute; background: ${SURFACE}; font-family: Roboto, Arial, sans-serif; white-space: nowrap; overflow: hidden; }
`;

export function googleCalendarFrames(): { week: string; event: string } | null {
  if (!existsSync(path.join(DIR, "week.jpg")) || !existsSync(path.join(DIR, "event.jpg"))) return null;
  const host = new URL(appConfig.appUrl).host;
  const week = `<!doctype html><style>${PAGE_STYLE}</style><div class="stage"><img class="shot" src="${dataUrl("week.jpg")}"></div>`;
  const event = `<!doctype html><style>${PAGE_STYLE}</style><div class="stage"><img class="shot" src="${dataUrl("week.jpg")}"><div class="dim"></div>
    <div class="pop"><img src="${dataUrl("event.jpg")}">
      <div class="patch" style="left:43px;top:195px;width:225px;height:19px;font-size:12px;line-height:19px;color:#0b57d0;text-decoration:underline">${host}/prickles/prkl_U4Fg…</div>
      <div class="patch" style="left:43px;top:233px;width:225px;height:34px;font-size:13px;line-height:17px;color:#1f1f1f">Hedgie Hub<br><span style="font-size:11px;color:#5f6368">Created by: Maya Example</span></div>
    </div></div>`;
  return { week, event };
}

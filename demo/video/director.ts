import type { BrowserContext, Locator, Page } from "playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sessionCookies } from "../auth";

/**
 * The director turns a Playwright page into a recording that reads like a product video: a visible cursor that
 * glides to what it clicks, a ripple on each click, a caption bar that says what you are looking at, and full-screen
 * title cards for the opening and the end. Everything is drawn into the page by one injected script, so the
 * recording needs no editing afterwards. Scenes are scripts of `say`, `click`, `show` and `card` calls.
 */

export const VIDEO_SIZE = { width: 1440, height: 810 } as const;
export const VIDEO_DIR = path.join("demo", "out", "video");

const OVERLAY_SCRIPT = `
(() => {
  if (window.__director) return;
  const css = \`
    #__d-cursor { position: fixed; z-index: 2147483646; left: 0; top: 0; width: 28px; height: 28px; pointer-events: none;
      transform: translate(-100px, -100px); transition: transform 0.05s linear; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    .__d-ripple { position: fixed; z-index: 2147483645; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
      border: 3px solid #b0457a; pointer-events: none; animation: __d-ripple .6s ease-out forwards; }
    @keyframes __d-ripple { to { transform: scale(3.4); opacity: 0; } }
    #__d-caption { position: fixed; z-index: 2147483644; left: 50%; bottom: 36px; transform: translate(-50%, 24px); opacity: 0;
      max-width: 78%; padding: 14px 26px; border-radius: 14px; background: rgba(33, 22, 38, .92); color: #fff;
      font: 600 24px/1.3 Inter, system-ui, sans-serif; text-align: center; pointer-events: none;
      transition: opacity .35s ease, transform .35s ease; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
    #__d-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #__d-card { position: fixed; z-index: 2147483647; inset: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 18px; text-align: center; padding: 60px; opacity: 0; pointer-events: none;
      background: radial-gradient(circle at 30% 20%, #8a3a67, #3a1b33 70%); color: #fff; transition: opacity .5s ease; }
    #__d-card.on { opacity: 1; }
    #__d-card h1 { margin: 0; font: 700 64px/1.1 'Playfair Display', Georgia, serif; letter-spacing: -.5px; }
    #__d-card p { margin: 0; font: 500 28px/1.35 Inter, system-ui, sans-serif; color: #f1d9e6; max-width: 1000px; }
    #__d-card small { font: 600 20px Inter, system-ui, sans-serif; color: #e9b8d2; letter-spacing: .08em; text-transform: uppercase; }
  \`;
  const style = document.createElement('style'); style.textContent = css;
  const mount = () => {
    document.head.appendChild(style);
    const cursor = document.createElement('div'); cursor.id = '__d-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 2l7.5 19 2.7-7.6L21 10.7z" fill="#fff" stroke="#211626" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const caption = document.createElement('div'); caption.id = '__d-caption';
    const card = document.createElement('div'); card.id = '__d-card';
    document.body.append(cursor, caption, card);
    addEventListener('mousemove', (e) => { cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__d-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
    // The first page of a recording opens on the title card's background, not a blank screen while it loads.
    if (!sessionStorage.getItem('__d')) {
      sessionStorage.setItem('__d', '1');
      card.style.transition = 'none';
      card.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => { card.style.transition = ''; }));
    }
    window.__director = {
      caption(text) {
        // Keep the words while the pill fades out, so it never shows empty.
        if (text) caption.textContent = text;
        caption.classList.toggle('on', !!text);
      },
      card(c) {
        if (!c) { card.classList.remove('on'); return; }
        card.innerHTML = (c.kicker ? '<small></small>' : '') + '<h1></h1>' + (c.line ? '<p></p>' : '');
        if (c.kicker) card.querySelector('small').textContent = c.kicker;
        card.querySelector('h1').textContent = c.title;
        if (c.line) card.querySelector('p').textContent = c.line;
        card.classList.add('on');
      },
    };
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
`;

export interface Director {
  page: Page;
  /** A caption under the screen; empty text clears it. */
  say(text: string, ms?: number): Promise<void>;
  /** Hold on the current screen. */
  hold(ms: number): Promise<void>;
  /** Glide the cursor to an element and pause there. */
  point(target: Locator, ms?: number): Promise<void>;
  /** Glide to an element, click it, and wait for what it does. */
  click(target: Locator, ms?: number): Promise<void>;
  /** Go to a page as a member would after clicking a link: the cursor rests where it was. */
  goto(url: string, ms?: number): Promise<void>;
  /** Scroll the app's own scroller (not the window) by an amount, smoothly. */
  scroll(by: number, ms?: number): Promise<void>;
  /** A full-screen title card; `null` clears it. */
  card(content: { kicker?: string; title: string; line?: string } | null, ms?: number): Promise<void>;
  /** Stop recording and save the video as demo/out/video/<name>.webm. */
  finish(name: string): Promise<string>;
}

async function glide(page: Page, x: number, y: number, from: { x: number; y: number }) {
  const distance = Math.hypot(x - from.x, y - from.y);
  const steps = Math.max(12, Math.min(60, Math.round(distance / 14)));
  // Ease in and out so it reads as a hand, not a robot.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(12);
  }
}

/**
 * Opens a recording context signed in as `personaKey`, warm: every page in `warm` is visited first in a context
 * that isn't recorded, so the recording shows the app responding, not compiling or loading for the first time.
 */
export async function startRecording(
  browser: import("playwright/test").Browser,
  baseURL: string,
  personaKey: string,
  warm: string[] = [],
  scheme: "light" | "dark" = "light",
): Promise<Director> {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const base = { baseURL, viewport: VIDEO_SIZE, colorScheme: scheme, locale: "en-US", timezoneId: "America/New_York" } as const;

  const log = (m: string) => process.env.DIRECTOR_LOG && console.log(`[director] ${m}`);
  const prepare = async (context: BrowserContext) => {
    log('cookies');
    await context.addCookies(await sessionCookies(personaKey));
    await context.addInitScript((t) => window.localStorage.setItem("theme", t), scheme);
    await context.addInitScript(() => {
      const hide = document.createElement("style");
      hide.textContent = "nextjs-portal, [data-feedback-widget], [data-environment-indicator] { display: none !important; }";
      document.addEventListener("DOMContentLoaded", () => document.head.appendChild(hide));
    });
  };

  if (warm.length > 0) {
    log('warm context');
    const warmup = await browser.newContext(base);
    await prepare(warmup);
    const w = await warmup.newPage();
    for (const url of warm) {
      log(`warm ${url}`);
      await w.goto(url, { waitUntil: "load", timeout: 20_000 }).catch(() => undefined);
      await w.waitForTimeout(600);
    }
    await warmup.close();
  }

  const context = await browser.newContext({ ...base, recordVideo: { dir: path.join(VIDEO_DIR, ".raw"), size: VIDEO_SIZE } });
  await prepare(context);
  await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();
  let at = { x: VIDEO_SIZE.width / 2, y: VIDEO_SIZE.height / 2 };

  const trace = (m: string) => process.env.DIRECTOR_LOG && console.log(`[director] ${m}`);
  const hold = (ms: number) => page.waitForTimeout(ms);
  const director: Director = {
    page,
    hold,
    async say(text, ms = 1800) {
      trace(`say ${text}`);
      await page.evaluate((t) => (window as unknown as { __director?: { caption(t: string): void } }).__director?.caption(t), text);
      await hold(ms);
    },
    async point(target, ms = 700) {
      trace(`point ${target}`);
      await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
      const box = await target.boundingBox({ timeout: 10_000 });
      if (!box) throw new Error("director.point: element has no box");
      const x = box.x + Math.min(box.width / 2, 120);
      const y = box.y + box.height / 2;
      await glide(page, x, y, at);
      at = { x, y };
      await hold(ms);
    },
    async click(target, ms = 1200) {
      // The caption belongs to the screen it was said on: let it go as the cursor moves to the next thing.
      await page.evaluate(() => (window as unknown as { __director?: { caption(t: string): void } }).__director?.caption(""));
      await director.point(target, 250);
      await page.mouse.down();
      await page.mouse.up();
      await hold(Math.min(ms, 700));
      // The app keeps the scroll position of the page it came from; a new view starts at its top.
      await page.evaluate(() => (document.querySelector("main") as HTMLElement | null)?.scrollTo(0, 0));
      await hold(Math.max(0, ms - 700));
    },
    async goto(url, ms = 900) {
      trace(`goto ${url}`);
      await page.goto(url, { waitUntil: "load" });
      await hold(ms);
    },
    async scroll(by, ms = 1200) {
      await page.evaluate(
        async (distance) => {
          const scroller = (document.querySelector("main") as HTMLElement | null) ?? document.scrollingElement!;
          const start = scroller.scrollTop;
          const t0 = performance.now();
          await new Promise<void>((resolve) => {
            const tick = (now: number) => {
              const t = Math.min(1, (now - t0) / 900);
              scroller.scrollTop = start + distance * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
              if (t < 1) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          });
        },
        by,
      );
      await hold(ms);
    },
    async card(content, ms = 2600) {
      trace(`card ${content?.title}`);
      await page.evaluate((c) => (window as unknown as { __director?: { card(c: unknown): void } }).__director?.card(c), content);
      await hold(content ? ms : 600);
    },
    async finish(name) {
      const video = page.video();
      await context.close();
      const out = path.join(VIDEO_DIR, `${name}.webm`);
      await video?.saveAs(out);
      return out;
    },
  };
  return director;
}

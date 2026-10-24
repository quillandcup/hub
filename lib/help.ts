import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Member help articles: markdown files in help/ (not docs/, which is for developers), one per topic. The file
 * name is the slug, so a link stays put when the title is reworded; the title is the first `# ` heading and the
 * summary the first paragraph after it. Read at build time by the /help pages. See docs/DEMO_AND_HELP.md.
 *
 * Screenshots are written as `![alt](img:<scene>/<file>)`, and live in the private help-images bucket, served by
 * /help/images/<scene>/<file> after a sign-in check.
 */
export const HELP_IMAGES_BUCKET = "help-images";

/**
 * The order articles appear in the index, from first steps to hosting. A new article is added here on purpose
 * (a test fails until it is); any article not listed sorts after these, by name.
 */
export const HELP_ORDER = ["join-a-prickle", "plan-your-month", "become-a-host", "start-a-pup", "run-a-prickle"];

const HELP_DIR = path.join(process.cwd(), "help");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  body: string;
}

export function isHelpSlug(value: string): boolean {
  return SLUG.test(value);
}

/** The path of an article, rebuilt from the validated slug (letters, digits and hyphens only) under a fixed prefix; null for anything else. */
export function helpArticlePath(slug: string): string | null {
  const match = SLUG.exec(slug);
  return match ? `/help/${match[0]}` : null;
}

/** An image name from the URL: a scene folder and a file, nothing that could climb out of the bucket. */
export function isHelpImagePath(scene: string, file: string): boolean {
  return SLUG.test(scene) && /^[a-z0-9][a-z0-9-]*\.(png|jpe?g|webp)$/.test(file);
}

/** The URL for an `img:<scene>/<file>` reference in an article, or null for any other source. */
export function helpImageUrl(src: string): string | null {
  const m = /^img:([a-z0-9-]+)\/([a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp))$/.exec(src);
  return m && isHelpImagePath(m[1], m[2]) ? `/help/images/${m[1]}/${m[2]}` : null;
}

/** Markdown as plain text, for a summary: link text without the target, no emphasis or code marks. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseHelpArticle(slug: string, markdown: string): HelpArticle {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const titleIndex = lines.findIndex((l) => l.startsWith("# "));
  const title = titleIndex >= 0 ? lines[titleIndex].slice(2).trim() : slug;
  const rest = lines.slice(titleIndex + 1).join("\n").trim();
  const firstBlock = rest.split(/\n{2,}/).find((b) => b.trim() && !/^(#|!\[|[-*]\s|\d+\.\s)/.test(b.trim()));
  return { slug, title, summary: plainText(firstBlock ?? ""), body: rest };
}

function rank(slug: string): number {
  const i = HELP_ORDER.indexOf(slug);
  return i === -1 ? HELP_ORDER.length : i;
}

export function listHelpArticles(dir: string = HELP_DIR): HelpArticle[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter(isHelpSlug)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((slug) => parseHelpArticle(slug, readFileSync(path.join(dir, `${slug}.md`), "utf8")));
}

export function loadHelpArticle(slug: string, dir: string = HELP_DIR): HelpArticle | null {
  if (!isHelpSlug(slug)) return null;
  const file = path.join(dir, `${slug}.md`);
  return existsSync(file) ? parseHelpArticle(slug, readFileSync(file, "utf8")) : null;
}

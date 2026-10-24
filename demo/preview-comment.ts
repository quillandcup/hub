/**
 * The sticky PR comment that shows the help screenshots inline, so a reviewer sees what a change did to the
 * articles without downloading anything. CI pushes the desktop-light images to the `help-previews` branch
 * (outside main; fictional data) and this writes the comment that links them by commit, so the pictures a
 * comment shows never change under it.
 *
 *   tsx demo/preview-comment.ts <owner/repo> <preview-commit-sha> <pr-number> <run-url>   prints the comment body
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { listHelpArticles, type HelpArticle } from "../lib/help";

/** Hidden marker the workflow looks for to update the same comment on every push instead of adding a new one. */
export const PREVIEW_MARKER = "<!-- help-previews -->";

export function previewImageUrl(repo: string, sha: string, pr: number, ref: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/pr-${pr}/${ref}`;
}

export function buildPreviewComment(articles: HelpArticle[], repo: string, sha: string, pr: number, runUrl: string): string {
  const sections: string[] = [];
  for (const a of articles) {
    const images = [...a.body.matchAll(/!\[([^\]]*)\]\(img:([^)]+)\)/g)].map((m) => `![${m[1]}](${previewImageUrl(repo, sha, pr, m[2])})`);
    if (images.length > 0) sections.push(`### ${a.title}\n\n${images.join("\n\n")}`);
  }
  return [
    PREVIEW_MARKER,
    "## Help screenshots",
    "What the help articles show, captured from this PR's code (desktop, light). All sizes and dark mode are in the [`demo-screenshots` artifact](" + runUrl + ").",
    sections.length > 0 ? sections.join("\n\n") : "_No article shows a screenshot yet._",
  ].join("\n\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, sha, pr, runUrl] = process.argv.slice(2);
  if (!repo || !sha || !pr || !runUrl) {
    console.error("Usage: tsx demo/preview-comment.ts <owner/repo> <preview-commit-sha> <pr-number> <run-url>");
    process.exit(1);
  }
  console.log(buildPreviewComment(listHelpArticles(), repo, sha, Number(pr), runUrl));
}

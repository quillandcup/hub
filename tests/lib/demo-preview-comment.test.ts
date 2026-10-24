import { describe, expect, it } from "vitest";
import { PREVIEW_MARKER, buildPreviewComment, previewImageUrl } from "@/demo/preview-comment";
import { parseHelpArticle } from "@/lib/help";

const article = (slug: string, md: string) => parseHelpArticle(slug, md);

describe("buildPreviewComment", () => {
  const articles = [
    article("a", "# First\n\nIntro.\n\n![The dashboard](img:scene-a/01-dashboard.png)\n\n![The popover](img:scene-a/02-popover.png)"),
    article("b", "# No pictures\n\nJust words."),
    article("c", "# Third\n\nIntro.\n\n![Elsewhere](img:scene-c/01-x.png)"),
  ];
  const body = buildPreviewComment(articles, "owner/repo", "abc123", 42, "https://github.com/owner/repo/actions/runs/9");

  it("starts with the marker the workflow uses to update one comment instead of adding more", () => {
    expect(body.startsWith(PREVIEW_MARKER)).toBe(true);
  });

  it("shows each article's screenshots inline, linked by preview commit so they never change under the comment", () => {
    expect(body).toContain("### First");
    expect(body).toContain("![The dashboard](https://raw.githubusercontent.com/owner/repo/abc123/pr-42/scene-a/01-dashboard.png)");
    expect(body).toContain(previewImageUrl("owner/repo", "abc123", 42, "scene-c/01-x.png"));
  });

  it("leaves out articles that show no screenshot, and links the full matrix", () => {
    expect(body).not.toContain("No pictures");
    expect(body).toContain("https://github.com/owner/repo/actions/runs/9");
  });

  it("says so when no article has a screenshot yet", () => {
    expect(buildPreviewComment([articles[1]], "o/r", "s", 1, "u")).toContain("No article shows a screenshot yet.");
  });
});

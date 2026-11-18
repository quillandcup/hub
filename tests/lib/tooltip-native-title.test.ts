import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A hint on a control goes through `components/Tooltip.tsx` (rule: `.claude/rules/tooltips.md`), not a native `title="..."`,
 * which is a small grey browser box that looks different from every other tooltip, never shows on a touch screen and
 * can't be styled. This fails on a native `title` attribute on a lowercase (DOM) JSX element in `app` or `components`
 * (not `<iframe title>`, which names the frame for screen readers; a component's own `title` prop, like a modal's, is not
 * a DOM attribute and is not counted), unless the file is in BASELINE with that many. The list is files that predate the
 * rule: convert one as you touch it and remove or lower its entry. It only shrinks: a stale or too-high entry fails, and
 * so does a file with more native titles than listed.
 */
const BASELINE: Record<string, number> = {
  "app/(admin)/admin/badges/BadgeTypeForm.tsx": 1,
  "app/(admin)/admin/care/CareFacts.tsx": 2,
  "app/(admin)/admin/care/EngagementCard.tsx": 1,
  "app/(admin)/admin/courses/BuilderOutline.tsx": 9,
  "app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonBuilderForm.tsx": 1,
  "app/(admin)/admin/courses/[id]/stats/LessonStats.tsx": 2,
  "app/(admin)/admin/courses/page.tsx": 1,
  "app/(admin)/admin/data-health/gap-fills/page.tsx": 1,
  "app/(admin)/admin/data/prickle-types/PrickleTypesTable.tsx": 1,
  "app/(admin)/admin/events/[slug]/EventDetailClient.tsx": 1,
  "app/(admin)/admin/hedgieversaries/HedgieversariesTable.tsx": 2,
  "app/(admin)/admin/hosts/HostsClient.tsx": 1,
  "app/(admin)/admin/insights/slack-engagement/SlackEngagementCharts.tsx": 1,
  "app/(admin)/admin/members/[id]/MemberNotificationsPanel.tsx": 1,
  "app/(admin)/admin/mentorship/MatchesPanel.tsx": 2,
  "app/(admin)/admin/page.tsx": 1,
  "app/(admin)/admin/pages/[slug]/LandingEditor.tsx": 1,
  "app/(admin)/admin/pages/new/NewPageForm.tsx": 1,
  "app/(admin)/admin/previews/PreviewsClient.tsx": 2,
  "app/(admin)/admin/users/UsersClient.tsx": 4,
  "app/(member)/hosting/HostingScheduleManager.tsx": 1,
  "app/(member)/members/MemberDirectory.tsx": 1,
  "app/(member)/my-prickles/AddToCalendar.tsx": 1,
  "app/(member)/my-prickles/CommitmentsManager.tsx": 2,
  "app/(member)/notifications/NotificationInbox.tsx": 1,
  "app/(member)/wheel-of-wonder/Wheel.tsx": 1,
  "components/AttendanceMonthGrid.tsx": 1,
  "components/AvatarStack.tsx": 1,
  "components/BadgeChip.tsx": 1,
  "components/CalendarWeekView.tsx": 2,
  "components/EmojiImage.tsx": 2,
  "components/FeaturePreviewsSection.tsx": 1,
  "components/MemberAttendanceView.tsx": 1,
  "components/PrickleDetails.tsx": 2,
  "components/ReactionEmoji.tsx": 1,
  "components/chat/ChatText.tsx": 1,
  "components/chat/EmojiPicker.tsx": 2,
  "components/chat/MessageItem.tsx": 2,
  "components/courses/CommentThread.tsx": 1,
  "components/writing/GoalProgressBar.tsx": 1,
  "components/writing/ProjectCharts.tsx": 1,
};

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** How many native `title` attributes (on a lowercase tag, not iframe) the source has. */
export function countNativeTitles(source: string): number {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText() === "title") {
      const tag = (node.parent.parent as ts.JsxOpeningLikeElement).tagName.getText();
      if (/^[a-z]/.test(tag) && tag !== "iframe") count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

describe("tooltips: native title", () => {
  const files = ["app", "components"]
    .flatMap((dir) => sourceFiles(path.join(root, dir)))
    .map((file) => [path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")] as const);
  const counts = new Map(files.map(([file, src]) => [file, countNativeTitles(src)]));

  it("counts a title on a DOM element only", () => {
    expect(countNativeTitles(`<button title="Pin">x</button>`)).toBe(1);
    expect(countNativeTitles(`<span title={a}>x</span><a href="/" title="b">y</a>`)).toBe(2);
    expect(countNativeTitles(`<Modal title="New" /><ChartCard title="x" /><Tooltip content="y"><button>z</button></Tooltip>`)).toBe(0);
    expect(countNativeTitles(`<iframe title="Video" src="/v" />`)).toBe(0);
    expect(countNativeTitles(`<svg><title>Chart</title></svg>`)).toBe(0);
  });

  it("has no native title tooltip outside the baseline (use <Tooltip content=...>)", () => {
    const offenders = [...counts].filter(([file, n]) => n > (BASELINE[file] ?? 0)).map(([file, n]) => `${file} (${n}, allowed ${BASELINE[file] ?? 0})`);
    expect(offenders, "wrap the control in <Tooltip content=...> from components/Tooltip.tsx instead of title= (.claude/rules/tooltips.md)").toEqual([]);
  });

  it("keeps the baseline honest: no entry for a file that no longer has that many (lower or remove it)", () => {
    const stale = Object.entries(BASELINE)
      .filter(([file, n]) => counts.get(file) !== n)
      .map(([file, n]) => `${file}: baseline ${n}, now ${counts.get(file) ?? "missing"}`);
    expect(stale).toEqual([]);
  });
});

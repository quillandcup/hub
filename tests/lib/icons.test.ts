import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Icons go through `src/components/Icon.tsx` (one name per meaning, drawn by lucide-react; rule: `.claude/rules/icons.md`).
 * This fails on
 *   1. a `lucide-react` import outside `src/components/Icon.tsx`, and
 *   2. an inline `<svg>` in `app` or `components`,
 * unless the file is listed. A custom drawing (a chart, a progress ring, a brand mark) is listed in CUSTOM_DRAWINGS for good.
 * The two BASELINE lists are files that predate the rule: convert one as you touch it and delete its entry. They only shrink:
 * a stale entry fails, and so does a baseline file that grows more inline SVGs than listed.
 */
const CUSTOM_DRAWINGS: Record<string, string> = {
  "src/app/(member)/hosting/HostingStats.tsx": "chart",
  "src/app/(admin)/admin/insights/slack-engagement/SlackEngagementCharts.tsx": "chart",
  "src/app/(admin)/admin/courses/[id]/stats/EngagementSparkline.tsx": "sparkline",
  "src/app/(admin)/admin/courses/[id]/stats/EngagementPanel.tsx": "chart and its legend swatches",
  "src/app/(admin)/admin/courses/[id]/stats/TimeSeriesChart.tsx": "chart",
  "src/app/(admin)/admin/members/network/NetworkGraph.tsx": "graph",
  "src/app/(admin)/admin/stats/CommunityStatsCharts.tsx": "chart",
  "src/components/writing/JourneyMap.tsx": "map drawing",
  "src/components/chat/PendingAttachments.tsx": "upload progress ring",
  "src/components/ChannelIcon.tsx": "brand marks (Slack, Zoom and the like)",
  "src/components/member/MemberSocialLinks.tsx": "brand marks of social networks",
};

/** Files that import lucide-react directly, from before `Icon` wrapped it. */
const LUCIDE_BASELINE: string[] = [
  "src/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonFilesField.tsx",
  "src/app/(admin)/admin/courses/[id]/lessons/[lessonId]/LessonTextEditor.tsx",
  "src/app/(admin)/admin/pages/[slug]/AiPanel.tsx",
  "src/app/(admin)/admin/pages/[slug]/LandingEditor.tsx",
  "src/app/(member)/settings/TimezoneSwitcher.tsx",
  "src/components/chat/EmojiPicker.tsx",
  "src/components/chat/FormatToolbar.tsx",
  "src/components/landing/fields.tsx",
];

/** Files with hand-pasted inline icons, and how many `<svg>` each holds today. */
const SVG_BASELINE: Record<string, number> = {
  "src/app/(admin)/admin/DashboardCharts.tsx": 1,
  "src/app/(admin)/admin/insights/prickles/PricklesTable.tsx": 1,
  "src/app/(admin)/admin/insights/prickles/[kind]/GroupedTable.tsx": 1,
  "src/app/(admin)/admin/members/[id]/MemberDetailPage.tsx": 2,
  "src/app/(admin)/admin/members/[id]/MemberSlackActivityPanel.tsx": 2,
  "src/app/(admin)/admin/pages/NewPageButton.tsx": 1,
  "src/app/(member)/courses/LessonSectionList.tsx": 1,
  "src/app/(member)/courses/[slug]/lessons/[lessonId]/page.tsx": 1,
  "src/app/(member)/courses/[slug]/modules/[moduleId]/page.tsx": 1,
  "src/app/(member)/my-prickles/AddToCalendar.tsx": 3,
  "src/app/(member)/my-prickles/CalendarSyncCard.tsx": 3,
  "src/app/(member)/settings/SessionsPanel.tsx": 1,
  "src/components/HelpMenu.tsx": 1,
  "src/components/InAppNotifications.tsx": 1,
  "src/components/InfoTip.tsx": 1,
  "src/components/RecordHistoryButton.tsx": 1,
  "src/components/UserMenu.tsx": 1,
  "src/components/chat/ChatSidebar.tsx": 2,
  "src/components/chat/ChatVideo.tsx": 1,
  "src/components/chat/DayJump.tsx": 1,
  "src/components/chat/MessageActions.tsx": 3,
  "src/components/chat/NewMessagePicker.tsx": 1,
  "src/components/chat/NotifySetting.tsx": 1,
  "src/components/courses/LessonPlayer.tsx": 1,
  "src/components/member/MemberHoverCard.tsx": 1,
  "src/components/search/SearchPalette.tsx": 5,
  "src/components/useSidebarMode.tsx": 1,
};

const root = path.resolve(__dirname, "../..");
const ICON_FILE = "src/components/Icon.tsx";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx|jsx)$/.test(entry.name) ? [full] : [];
  });
}

const LUCIDE_IMPORT = /\bfrom\s+["']lucide-react["']/;
const SVG_TAG = /<svg\b/g;

export const importsLucide = (source: string) => LUCIDE_IMPORT.test(source);
export const countSvgs = (source: string) => (source.match(SVG_TAG) ?? []).length;

describe("icons", () => {
  const files = ["src/app", "src/components"]
    .flatMap((dir) => sourceFiles(path.join(root, dir)))
    .map((file) => [path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")] as const)
    .filter(([file]) => file !== ICON_FILE);

  it("detects a lucide import and an inline svg", () => {
    expect(importsLucide(`import { Pencil } from "lucide-react";`)).toBe(true);
    expect(importsLucide(`import {\n  Pencil,\n} from 'lucide-react'`)).toBe(true);
    expect(importsLucide(`import Icon from "@/components/Icon";`)).toBe(false);
    expect(countSvgs(`<svg viewBox="0 0 20 20"><path d="M0 0" /></svg><svg>`)).toBe(2);
    expect(countSvgs(`<Icon name="edit" />`)).toBe(0);
  });

  it("has no lucide-react import outside src/components/Icon.tsx (use <Icon name>)", () => {
    const offenders = files.filter(([file, src]) => importsLucide(src) && !LUCIDE_BASELINE.includes(file)).map(([file]) => file);
    expect(offenders, "use <Icon name=...> from src/components/Icon.tsx; add a name there if the meaning is missing (.claude/rules/icons.md)").toEqual([]);
  });

  it("has no inline <svg> icon outside the custom drawings and the baseline (use <Icon name>)", () => {
    const offenders = files
      .filter(([file, src]) => countSvgs(src) > (SVG_BASELINE[file] ?? 0) && !(file in CUSTOM_DRAWINGS))
      .map(([file, src]) => `${file} (${countSvgs(src)})`);
    expect(offenders, "use <Icon name=...> from src/components/Icon.tsx; a chart or brand mark goes in CUSTOM_DRAWINGS with a reason (.claude/rules/icons.md)").toEqual([]);
  });

  it("keeps the baselines and the custom list honest: no entry for a file that no longer needs it", () => {
    const byFile = new Map(files);
    for (const file of LUCIDE_BASELINE) expect(importsLucide(byFile.get(file) ?? ""), `stale lucide baseline: ${file}`).toBe(true);
    for (const [file, count] of Object.entries(SVG_BASELINE)) expect(countSvgs(byFile.get(file) ?? ""), `stale svg baseline (set it to the real count, or remove it): ${file}`).toBe(count);
    for (const file of Object.keys(CUSTOM_DRAWINGS)) expect(countSvgs(byFile.get(file) ?? ""), `stale custom drawing: ${file}`).toBeGreaterThan(0);
    for (const file of [...LUCIDE_BASELINE, ...Object.keys(SVG_BASELINE)]) expect(file in CUSTOM_DRAWINGS, `${file} is in a baseline and in CUSTOM_DRAWINGS`).toBe(false);
  });
});

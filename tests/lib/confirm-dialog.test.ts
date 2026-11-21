import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Confirmations go through `src/components/ConfirmDialog.tsx` (`ConfirmDialog`, or `useConfirm()` where a handler used to say
 * `if (!confirm(...)) return;`; rule and wording: `.claude/rules/confirmations.md`). This fails on a `confirm(` or
 * `window.confirm(` in `app` or `components` beyond what CONFIRM_BASELINE lists. The baseline is files that predate the
 * rule and how many calls each holds: convert one as you touch it and lower or delete its entry. It only shrinks: a stale or
 * too-high entry fails, and so does a file with more calls than listed.
 */
const CONFIRM_BASELINE: Record<string, number> = {
  "src/app/(admin)/admin/badges/BadgeTypeForm.tsx": 1,
  "src/app/(admin)/admin/care/EngagementCard.tsx": 2,
  "src/app/(admin)/admin/data-health/missing-hosts/MissingHostsClient.tsx": 1,
  "src/app/(admin)/admin/data/prickle-types/UnmatchedEventsTable.tsx": 1,
  "src/app/(admin)/admin/data/slack-channels/RestrictionToggle.tsx": 1,
  "src/app/(admin)/admin/hosts/HostsClient.tsx": 3,
  "src/app/(admin)/admin/hygiene/ProcessOrphanedButton.tsx": 1,
  "src/app/(admin)/admin/hygiene/ProcessOrphanedMeetingsButton.tsx": 1,
  "src/app/(admin)/admin/member-overrides/MemberOverridesClient.tsx": 1,
  "src/app/(admin)/admin/members/[id]/MemberIdentityPanel.tsx": 2,
  "src/app/(admin)/admin/members/[id]/MemberTimelinePanel.tsx": 1,
  "src/app/(admin)/admin/mentorship/MatchesPanel.tsx": 1,
  "src/app/(admin)/admin/previews/PreviewsClient.tsx": 2,
  "src/app/(admin)/admin/programs/[id]/ProgramDetailClient.tsx": 2,
  "src/app/(member)/hosting/HostingScheduleManager.tsx": 1,
  "src/app/(member)/projects/MyAwardsPanel.tsx": 1,
  "src/app/(member)/projects/MyBooksPanel.tsx": 1,
  "src/app/(member)/projects/[id]/ProjectDetailClient.tsx": 2,
  "src/components/chat/MessageFiles.tsx": 1,
  "src/components/writing/ProjectDetailsModal.tsx": 1,
};

const root = path.resolve(__dirname, "../..");
const DIALOG_FILE = "src/components/ConfirmDialog.tsx";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx|jsx)$/.test(entry.name) ? [full] : [];
  });
}

// `confirm(` or `window.confirm(`, but not `onConfirm(`, `ctx.confirm(` or `askToConfirm(`.
const NATIVE_CONFIRM = /(?<![\w.])(?:window\.)?confirm\(/g;
export const countConfirms = (source: string) => (source.match(NATIVE_CONFIRM) ?? []).length;

describe("confirmations", () => {
  const files = ["src/app", "src/components"]
    .flatMap((dir) => sourceFiles(path.join(root, dir)))
    .map((file) => [path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")] as const)
    .filter(([file]) => file !== DIALOG_FILE);

  it("detects the browser's confirm", () => {
    expect(countConfirms(`if (!confirm("Sure?")) return;`)).toBe(1);
    expect(countConfirms(`if (!window.confirm(msg)) return; window.confirm(x)`)).toBe(2);
    expect(countConfirms(`onConfirm(); ctx.confirm(); askToConfirm(); await ask({ confirmLabel })`)).toBe(0);
  });

  it("has no new window.confirm (use ConfirmDialog or useConfirm)", () => {
    const offenders = files.filter(([file, src]) => countConfirms(src) > (CONFIRM_BASELINE[file] ?? 0)).map(([file, src]) => `${file} (${countConfirms(src)})`);
    expect(offenders, "use <ConfirmDialog> or useConfirm() from src/components/ConfirmDialog.tsx (.claude/rules/confirmations.md)").toEqual([]);
  });

  it("keeps the baseline honest: no entry for a call that is gone", () => {
    const byFile = new Map(files);
    for (const [file, count] of Object.entries(CONFIRM_BASELINE)) {
      expect(countConfirms(byFile.get(file) ?? ""), `stale baseline (set it to the real count, or remove it): ${file}`).toBe(count);
    }
  });
});

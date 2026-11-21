import type { A11yIssue } from "@/lib/landing/a11y";

/** The publish check's findings: "Fix" stops a publish, "Check" is a warning. Shown by the publish dialog and the JSON import preview. */
export default function IssueList({ issues }: { issues: A11yIssue[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {issues.map((issue, i) => (
        <li key={i} className={issue.severity === "error" ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-300"}>
          <span className="font-semibold">{issue.severity === "error" ? "Fix: " : "Check: "}</span>
          {issue.block}: {issue.message}
        </li>
      ))}
    </ul>
  );
}

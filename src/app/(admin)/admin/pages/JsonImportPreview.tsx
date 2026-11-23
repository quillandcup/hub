import type { JsonImportSummary } from "./actions";
import IssueList from "./[slug]/IssueList";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The plain-words account of what an import would do, from the dry run's summary. */
export default function JsonImportPreview({ summary, newPage = false }: { summary: JsonImportSummary; newPage?: boolean }) {
  const leftOutCount = summary.leftOut.reduce((sum, l) => sum + l.count, 0);
  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      <p>
        The file has {plural(summary.blocksAfter, "block", "blocks")}.{newPage ? "" : ` Your draft has ${plural(summary.blocksBefore, "block", "blocks")}.`}
      </p>
      {summary.identical && <p className="font-medium">This is the same as your draft, so nothing would change.</p>}
      {leftOutCount > 0 && (
        <p className="text-amber-800 dark:text-amber-300">
          {plural(leftOutCount, "block the builder doesn't have was", "blocks the builder doesn't have were")} left out: {summary.leftOut.map((l) => (l.count > 1 ? `${l.type} (${l.count})` : l.type)).join(", ")}.
        </p>
      )}
      {summary.droppedProps > 0 && (
        <p className="text-amber-800 dark:text-amber-300">{plural(summary.droppedProps, "setting a block doesn't have was", "settings blocks don't have were")} left out.</p>
      )}
      {summary.removedPictures > 0 && (
        <p className="text-amber-800 dark:text-amber-300">{plural(summary.removedPictures, "picture was", "pictures were")} not found in this media library and {summary.removedPictures === 1 ? "was" : "were"} removed.</p>
      )}
      {summary.issues.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">The publish check would say:</p>
          <IssueList issues={summary.issues} />
        </div>
      )}
      {summary.issues.length === 0 && !summary.identical && <p>The publish check finds nothing to fix.</p>}
    </div>
  );
}


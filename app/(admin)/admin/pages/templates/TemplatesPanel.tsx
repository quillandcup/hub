"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import LifecycleButton from "@/components/LifecycleButton";
import TableKeyboardNav from "@/components/TableKeyboardNav";
import Tooltip from "@/components/Tooltip";
import { DataTablePager } from "@/components/DataTablePager";
import { DataTableSearch } from "@/components/DataTableSearch";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { deleteLandingTemplate } from "../template-actions";
import TemplateHistory from "./TemplateHistory";
import { RenameTemplateDialog, UseTemplateDialog } from "./TemplateDialogs";

export type TemplateRow = { id: string; name: string; description: string; versions: number; updatedBy: string; updatedAt: string };

type Column = "name" | "versions" | "updated";

const ACTION = "inline-flex rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800";
const USE = "rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

/**
 * The Templates tab of Admin > Pages (docs/LANDING_PAGES.md, "Templates"): each saved template with its description, how many versions
 * it has and who changed it last, and Use (a new page from it), History (every version, with Bring back), Rename and Delete.
 * Template ids are Tier 2: they go from here to the server actions and nowhere else (never a link).
 */
export default function TemplatesPanel({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [using, setUsing] = useState<TemplateRow | null>(null);
  const [history, setHistory] = useState<TemplateRow | null>(null);
  const [renaming, setRenaming] = useState<TemplateRow | null>(null);
  const [pending, start] = useTransition();
  const table = useDataTable<TemplateRow, Column>({
    rows: templates,
    search: (t) => `${t.name} ${t.description}`,
    getSortValue: (t, column) => (column === "name" ? t.name.toLowerCase() : column === "versions" ? t.versions : Date.parse(t.updatedAt)),
    defaultSort: { column: "name", direction: "asc" },
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DataTableSearch table={table} label="Search templates" />
        {message && (
          <p role="status" className="text-sm text-slate-700 dark:text-slate-300">
            {message}
          </p>
        )}
      </div>
      <TableKeyboardNav table={table} label="Templates">
        {templates.length === 0 ? (
          <p className="rounded-lg bg-white p-6 text-sm text-slate-600 shadow dark:bg-slate-900 dark:text-slate-400">
            No templates yet. Open a page, then History, then Save as template.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <SortableTh label="Template" {...table.sortProps("name")} />
                  <SortableTh label="Versions" {...table.sortProps("versions")} />
                  <SortableTh label="Last changed" {...table.sortProps("updated")} />
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-6 py-3">
                      <span className="font-medium">{t.name}</span>
                      {t.description && <span className="block text-xs text-slate-600 dark:text-slate-400">{t.description}</span>}
                    </td>
                    <td className="px-6 py-3">{t.versions}</td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-400">
                      <time dateTime={t.updatedAt}>{new Date(t.updatedAt).toLocaleString()}</time>
                      <span className="block text-xs">by {t.updatedBy}</span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right">
                      <button type="button" data-row-primary className={USE} onClick={() => setUsing(t)}>
                        Use
                      </button>
                      <LifecycleButton action="history" noun="template" variant="icon" className={ACTION} onRun={() => setHistory(t)} />
                      <Tooltip content="Rename template">
                        <button type="button" aria-label="Rename template" className={ACTION} onClick={() => setRenaming(t)}>
                          <Icon name="rename" />
                        </button>
                      </Tooltip>
                      <LifecycleButton
                        action="delete"
                        noun="template"
                        title={t.name}
                        detail="Pages made from it are not affected. Its versions are kept."
                        variant="icon"
                        disabled={pending}
                        className={ACTION}
                        onRun={() =>
                          start(async () => {
                            setMessage(null);
                            const result = await deleteLandingTemplate(t.id);
                            if (result.error) return setMessage(result.error);
                            router.refresh();
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DataTablePager table={table} itemLabel="templates" />
      </TableKeyboardNav>
      <UseTemplateDialog template={using} onClose={() => setUsing(null)} />
      <TemplateHistory template={history} onClose={() => setHistory(null)} onChanged={() => router.refresh()} />
      <RenameTemplateDialog template={renaming} onClose={() => setRenaming(null)} onSaved={() => router.refresh()} />
    </div>
  );
}

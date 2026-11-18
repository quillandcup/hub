"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";
import LifecycleButton from "@/components/LifecycleButton";
import LifecycleStatusChip from "@/components/LifecycleStatusChip";
import { DataTablePager } from "@/components/DataTablePager";
import { DataTableSearch } from "@/components/DataTableSearch";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { lifecycleIcon, lifecycleLabel } from "@/lib/lifecycle-actions";
import type { LandingPageSummary } from "@/lib/data/landing-pages";
import { deleteLandingPage, duplicateLandingPage } from "./actions";
import TableKeyboardNav from "@/components/TableKeyboardNav";
import Tooltip from "@/components/Tooltip";

type Column = "title" | "status" | "updated";

const ACTION = "inline-flex rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800";

function Glyph({ name, label }: { name: IconName; label: string }) {
  return (
    <>
      <Icon name={name} />
      <span className="sr-only">{label}</span>
    </>
  );
}

export default function PagesTable({ pages, publicBase }: { pages: LandingPageSummary[]; publicBase: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const table = useDataTable<LandingPageSummary, Column>({
    rows: pages,
    search: (p) => `${p.title} ${p.slug} ${p.status}`,
    getSortValue: (p, column) => (column === "title" ? p.title.toLowerCase() : column === "status" ? p.status : Date.parse(p.updated_at)),
    defaultSort: { column: "updated", direction: "desc" },
  });

  async function copyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(`${publicBase}/p/${slug}`);
      setMessage("Link copied.");
    } catch {
      setMessage(`${publicBase}/p/${slug}`);
    }
  }

  function run(task: () => Promise<{ error?: string; slug?: string }>, then?: (slug?: string) => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await task();
      if (result.error) return setMessage(result.error);
      if (then) then(result.slug);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <DataTableSearch table={table} label="Search pages" />
        {message && (
          <p role="status" className="text-sm text-slate-700 dark:text-slate-300">
            {message}
          </p>
        )}
      </div>
      <TableKeyboardNav table={table} label="Pages">
      {pages.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-sm text-slate-600 shadow dark:bg-slate-900 dark:text-slate-400">No pages yet. Make the first one with New page.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800">
              <tr>
                <SortableTh label="Page" {...table.sortProps("title")} />
                <SortableTh label="Status" {...table.sortProps("status")} />
                <SortableTh label="Changed" {...table.sortProps("updated")} />
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-6 py-3">
                    <Link href={`/admin/pages/${p.slug}`} className="font-medium text-plum-700 hover:underline dark:text-plum-300">
                      {p.title}
                    </Link>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">/p/{p.slug}</span>
                  </td>
                  <td className="px-6 py-3">
                    <LifecycleStatusChip published={p.status === "published"} />
                  </td>
                  <td className="px-6 py-3 text-slate-600 dark:text-slate-400">
                    <time dateTime={p.updated_at}>{new Date(p.updated_at).toLocaleString()}</time>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right">
                    <Link href={`/admin/pages/${p.slug}`} className={ACTION} title="Customize">
                      <Glyph name="edit" label="Customize" />
                    </Link>
                    <Link href={`/admin/pages/${p.slug}/preview`} className={ACTION} title={lifecycleLabel("preview")}>
                      <Glyph name={lifecycleIcon("preview")} label={lifecycleLabel("preview")} />
                    </Link>
                    {p.status === "published" && (
                      <Tooltip content="Copy link">
                        <button type="button" onClick={() => void copyLink(p.slug)} className={ACTION}>
                          <Glyph name="link" label="Copy link" />
                        </button>
                      </Tooltip>
                    )}
                    <LifecycleButton
                      action="duplicate"
                      noun="page"
                      variant="icon"
                      disabled={pending}
                      onRun={() => run(() => duplicateLandingPage(p.id), (slug) => router.push(`/admin/pages/${slug}`))}
                      className={ACTION}
                    />
                    <LifecycleButton
                      action="delete"
                      noun="page"
                      title={p.title}
                      detail={p.status === "published" ? "It disappears from the public site." : undefined}
                      variant="icon"
                      disabled={pending}
                      onRun={() => run(() => deleteLandingPage(p.id))}
                      className={ACTION}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DataTablePager table={table} itemLabel="pages" />
      </TableKeyboardNav>
    </div>
  );
}

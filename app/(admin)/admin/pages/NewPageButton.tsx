"use client";

import { useState } from "react";
import Link from "next/link";
import ActionMenu from "@/components/ActionMenu";
import ImportKajabiDialog from "./ImportKajabiDialog";

/** "New page" with a chevron beside it: the menu holds the other ways to start a page (today, importing a Kajabi page export). */
export default function NewPageButton({ defaultType = "website" }: { defaultType?: "website" | "landing" }) {
  const [importing, setImporting] = useState(false);
  return (
    <>
      <div className="flex">
        <Link href={`/admin/pages/new?type=${defaultType}`} className="rounded-l bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700">
          New page
        </Link>
        <ActionMenu
          label="More ways to start a page"
          triggerClassName="flex h-full items-center rounded-r border-l border-plum-700 bg-plum-600 px-2 text-white hover:bg-plum-700"
          trigger={
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          items={[{ key: "kajabi", label: "Import from Kajabi", hint: "From a page export (zip). Makes a draft.", onSelect: () => setImporting(true), track: "pages_import_kajabi_open" }]}
        />
      </div>
      <ImportKajabiDialog isOpen={importing} onClose={() => setImporting(false)} />
    </>
  );
}

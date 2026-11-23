"use client";

import { useState } from "react";
import Link from "next/link";
import ActionMenu from "@/components/ActionMenu";
import ImportJsonDialog from "./ImportJsonDialog";
import ImportKajabiDialog from "./ImportKajabiDialog";
import type { TemplateChoice } from "./new/NewPageForm";
import StartFromTemplateDialog from "./StartFromTemplateDialog";

type Dialog = "template" | "json" | "kajabi" | null;

/**
 * "New page" with a chevron beside it: the menu holds the other ways to start a page, in the order a person reaches for them: a
 * published template, a JSON file exported from the builder, a Kajabi page export.
 */
export default function NewPageButton({ defaultType = "website", templates = [] }: { defaultType?: "website" | "landing"; templates?: TemplateChoice[] }) {
  const [open, setOpen] = useState<Dialog>(null);
  const close = () => setOpen(null);
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
          items={[
            { key: "template", label: "Start from a template", hint: "One of your published templates. Makes a draft.", onSelect: () => setOpen("template"), track: "pages_start_from_template_open" },
            { key: "json", label: "Import from JSON", hint: "A file or pasted text from the builder. Makes a draft.", onSelect: () => setOpen("json"), track: "pages_import_json_open" },
            { key: "kajabi", label: "Import from Kajabi", hint: "From a page export (zip). Makes a draft.", onSelect: () => setOpen("kajabi"), track: "pages_import_kajabi_open" },
          ]}
        />
      </div>
      <StartFromTemplateDialog isOpen={open === "template"} onClose={close} templates={templates} />
      <ImportJsonDialog isOpen={open === "json"} onClose={close} defaultType={defaultType} />
      <ImportKajabiDialog isOpen={open === "kajabi"} onClose={close} />
    </>
  );
}

"use client";

import type { Field, Fields } from "@puckeditor/core";
import type { PageBlockRegistry } from "./block-registry";
import PlaceholderTextField from "./PlaceholderTextField";
import type { PlaceholderName } from "@/lib/landing/placeholders";
import { ImageField, RichTextField, ZonedDateTimeField } from "./fields";

/**
 * The editor side of a page block: the Puck fields that edit it. They live apart from the block's definition because they pull in the
 * editor (TipTap, the media picker), which the public page must not ship. A contribution's `fields` get this kit, so the
 * pages code and a module build fields the same way, and the slots they declare follow the registry the config is built from.
 */

export type EditorKit = {
  text: (label: string) => Field;
  area: (label: string) => Field;
  select: (label: string, options: { label: string; value: string }[]) => Field;
  toggle: (label: string) => Field;
  opts: (...values: string[]) => { label: string; value: string }[];
  image: (label: string) => Field;
  richText: (label: string) => Field;
  /** One line of text that can hold placeholders (`{year}`), shown as pills; the field offers only the names it is given. */
  placeholderText: (label: string, placeholders: readonly PlaceholderName[]) => Field;
  dateTime: (label: string) => Field;
  /** A button label and an address. */
  link: (label: string) => Field;
  /** Where a block's content comes from: typed by hand, or live from the Hub. */
  source: Field;
  /** A slot that holds any block except the parts of other blocks (a lone Finisher card or step means nothing on its own). */
  contentSlot: () => Field;
  /** The list of items a block holds, each a block of its own: they drag on the canvas, and are edited by clicking one. */
  itemsSlot: (block: string, label: string) => Field;
};

/** The editor fields of one contribution, by block type. */
export type PageBlockEditorContribution = { id: string; fields: (kit: EditorKit) => Record<string, Fields> };

const text = (label: string): Field => ({ type: "text", label });
const select = (label: string, options: { label: string; value: string }[]): Field => ({ type: "select", label, options });

export function createEditorKit(registry: Pick<PageBlockRegistry, "itemBlocks" | "slotAllow">): EditorKit {
  return {
    text,
    area: (label) => ({ type: "textarea", label }),
    select,
    toggle: (label) => ({
      type: "radio",
      label,
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    }),
    opts: (...values) => values.map((v) => ({ label: v[0].toUpperCase() + v.slice(1), value: v })),
    image: (label) => ({
      type: "custom",
      label,
      render: ({ value, onChange }) => <ImageField value={value as string | undefined} onChange={onChange} />,
    }),
    richText: (label) => ({
      type: "custom",
      label,
      render: ({ value, onChange }) => <RichTextField label={label} value={(value as string) ?? ""} onChange={onChange} />,
    }),
    placeholderText: (label, placeholders) => ({
      type: "custom",
      label,
      render: ({ value, onChange }) => <PlaceholderTextField label={label} value={(value as string) ?? ""} onChange={onChange} placeholders={placeholders} />,
    }),
    dateTime: (label) => ({
      type: "custom",
      label,
      render: ({ value, onChange }) => <ZonedDateTimeField label={label} value={(value as string) ?? ""} onChange={onChange} />,
    }),
    link: (label) => ({ type: "object", label, objectFields: { label: text("Button label"), href: text("Link (https://, or a path on this site)") } }),
    source: select("Where the content comes from (live shows on the published page; here you see what you typed)", [
      { label: "Typed in by hand", value: "manual" },
      { label: "Live from the Hub", value: "live" },
    ]),
    contentSlot: () => ({ type: "slot", disallow: registry.itemBlocks }),
    itemsSlot: (block, label) => ({ type: "slot", label, allow: registry.slotAllow[block]?.items }),
  };
}

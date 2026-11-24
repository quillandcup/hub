// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { BLOCK_DEFAULTS, SLOTS } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";
import { EXTRA_PROPS, ROOT_PROPS } from "@/lib/landing/json-transfer";

/**
 * JSON import keeps only the props a block has (src/lib/landing/json-transfer.ts). That list is the block's defaults, its slots
 * and `EXTRA_PROPS`; this fails when the editor gives a block a field the import would drop, so a new field is added to
 * `EXTRA_PROPS` (or the block's defaults) in the same change.
 */
describe("what JSON import keeps matches what the editor edits", () => {
  const known = (name: keyof typeof BLOCK_DEFAULTS) => new Set([...Object.keys(BLOCK_DEFAULTS[name]), ...(SLOTS[name] ?? []), ...(EXTRA_PROPS[name] ?? []), "id", "span", "spanMobile"]);

  it.each(Object.keys(BLOCK_DEFAULTS) as (keyof typeof BLOCK_DEFAULTS)[])("%s: every field of the editor is kept", (name) => {
    // A key ending in "Heading" is a group heading in the panel (editor-config.tsx): it edits and stores nothing.
    const fields = Object.keys(editorConfig.components[name].fields ?? {}).filter((f) => !f.endsWith("Heading"));
    expect(fields.filter((f) => !known(name).has(f))).toEqual([]);
  });

  it("the page frame: every field of the editor is kept", () => {
    const fields = Object.keys(editorConfig.root?.fields ?? {});
    expect(fields.filter((f) => !ROOT_PROPS.includes(f))).toEqual([]);
  });

  it("EXTRA_PROPS names only blocks that exist", () => {
    for (const name of Object.keys(EXTRA_PROPS)) expect(Object.keys(BLOCK_DEFAULTS)).toContain(name);
  });
});

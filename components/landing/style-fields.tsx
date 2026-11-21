"use client";

import MediaPicker from "@/components/media/MediaPicker";
import { BUTTON_RADII, BUTTON_SIZES, FAVICON_MAX_PX, FAVICON_MIN_PX, FONT_FAMILIES, FONT_WEIGHTS, LINE_HEIGHTS, PAGE_BACKGROUNDS, PRIMARY_COLORS, faviconProblem, type StyleKey, type StyleTokens } from "@/lib/landing/style";

const SELECT = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";

const FIELDS: { key: StyleKey; label: string; options: readonly { value: string; label: string }[] }[] = [
  { key: "pageBackground", label: "Page background", options: PAGE_BACKGROUNDS },
  { key: "primary", label: "Primary colour (buttons, accents and links)", options: PRIMARY_COLORS },
  { key: "buttonSize", label: "Button size", options: BUTTON_SIZES },
  { key: "buttonRadius", label: "Button corners", options: BUTTON_RADII },
  { key: "fontFamily", label: "Body font", options: FONT_FAMILIES },
  { key: "fontWeight", label: "Body weight", options: FONT_WEIGHTS },
  { key: "lineHeight", label: "Line height", options: LINE_HEIGHTS },
];

/**
 * The style guide's fields (lib/landing/style.ts): each a short list, never a free colour or font. Used by the Design view for the
 * site's style and by a landing page's Settings for its own. `disabled` shows the values without letting them change.
 */
export function StyleFields({ value, onChange, disabled = false }: { value: StyleTokens; onChange: (key: StyleKey, next: string) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
      {FIELDS.map((f) => (
        <label key={f.key} className="block text-sm font-medium">
          {f.label}
          <select value={value[f.key]} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value)} className={SELECT}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

/** The favicon picker: a media library picture, refused with the reason when it is the wrong shape. The picker knows the size, not the file type, which is checked again on publish. */
export function FaviconField({ value, onChange }: { value: string; onChange: (assetId: string) => void }) {
  return (
    <div className="space-y-1 text-sm">
      <MediaPicker
        value={value || null}
        onChange={(id, asset) => {
          if (!id) return void onChange("");
          const problem = asset ? faviconProblem({ width: asset.width, height: asset.height }) : null;
          if (problem) return problem;
          onChange(id);
        }}
        surface="landing_page"
        preview="thumb"
        noun="favicon"
      />
      <p className="text-xs text-slate-600 dark:text-slate-400">
        The small picture in the browser tab. A square PNG, {FAVICON_MIN_PX} by {FAVICON_MIN_PX} pixels or more (up to {FAVICON_MAX_PX}).
      </p>
    </div>
  );
}

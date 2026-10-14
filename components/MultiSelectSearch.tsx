"use client";

import MultiEntitySearch from "@/components/MultiEntitySearch";

interface MultiSelectSearchProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
  /** Optional note shown on a chip, e.g. flagging a selected value that's no longer in `options`. */
  chipNote?: (value: string) => string | undefined;
}

/** Generic string variant of MultiMemberSearch: MultiEntitySearch with each value as its own id and name. */
export default function MultiSelectSearch({
  options,
  selected,
  onChange,
  placeholder = "Search...",
  className = "",
  chipNote,
}: MultiSelectSearchProps) {
  return (
    <MultiEntitySearch
      items={options.map((o) => ({ id: o, name: o }))}
      selectedIds={selected}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      showUnknown
      chipNote={chipNote}
    />
  );
}

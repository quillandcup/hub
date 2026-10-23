/** Safe, unique entry names for a zip: no paths or odd characters, repeats become "name (2).ext". */
export function uniqueZipNames(names: (string | null)[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = (raw ?? "file").replace(/[\\/]+/g, "_").replace(/[^A-Za-z0-9._ ()-]+/g, "_").replace(/^\.+/, "_").trim() || "file";
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

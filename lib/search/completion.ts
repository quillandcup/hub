import { KIND_LABELS } from "@/lib/search/kinds";
import { SEARCH_KINDS } from "@/lib/search/syntax";

/**
 * Autocomplete for the value of an operator being typed at the end of the search box
 * (`from:an`, `in:pr`, `has:`). Members and channels come from the server (the palette asks);
 * everything else is a fixed list here.
 */
export interface CompletionContext {
  operator: string;
  /** What is typed after the colon, without a leading quote. */
  typed: string;
}

export interface CompletionOption {
  /** What goes after the colon. */
  value: string;
  label: string;
  sublabel?: string;
  imageUrl?: string | null;
}

const OPERATORS_WITH_VALUES = ["in", "kind", "type", "from", "channel", "has", "is", "after", "before", "on", "during"];
/** The ones whose choices live in the database. */
export const SERVER_OPERATORS = ["from", "channel"] as const;
export type ServerOperator = (typeof SERVER_OPERATORS)[number];

export function completionContext(input: string): CompletionContext | null {
  const m = /(?:^|\s)([a-z]+):("[^"]*|[^\s"]*)$/i.exec(input);
  if (!m) return null;
  const operator = m[1].toLowerCase();
  if (!OPERATORS_WITH_VALUES.includes(operator)) return null;
  return { operator, typed: m[2].replace(/^"/, "") };
}

export const isServerOperator = (op: string): op is ServerOperator => (SERVER_OPERATORS as readonly string[]).includes(op);

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ym = (d: Date) => ymd(d).slice(0, 7);
const daysAgo = (now: Date, n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);

/** Fixed choices for an operator, or null when the choices come from the server. */
export function staticOptions(ctx: CompletionContext, now: Date): CompletionOption[] | null {
  const typed = ctx.typed.toLowerCase();
  const matching = (options: CompletionOption[]) =>
    options.filter((o) => o.value.startsWith(typed) || o.label.toLowerCase().split(" ").some((word) => word.startsWith(typed)));
  switch (ctx.operator) {
    case "in":
    case "kind":
    case "type":
      return SEARCH_KINDS.filter((k) => k.startsWith(typed) || KIND_LABELS[k].toLowerCase().startsWith(typed)).map((k) => ({ value: k, label: KIND_LABELS[k] }));
    case "has":
      return matching([
        { value: "link", label: "A link" },
        { value: "file", label: "A file" },
        { value: "reaction", label: "A reaction" },
      ]);
    case "is":
      return matching([{ value: "thread", label: "A thread" }]);
    case "after":
    case "before":
    case "on":
      // Someone typing digits is writing their own date.
      return /^\d/.test(typed)
        ? []
        : matching([
            { value: ymd(now), label: "Today", sublabel: ymd(now) },
            { value: ymd(daysAgo(now, 1)), label: "Yesterday", sublabel: ymd(daysAgo(now, 1)) },
            { value: ymd(daysAgo(now, 7)), label: "7 days ago", sublabel: ymd(daysAgo(now, 7)) },
            { value: ymd(daysAgo(now, 30)), label: "30 days ago", sublabel: ymd(daysAgo(now, 30)) },
          ]);
    case "during":
      return /^\d/.test(typed)
        ? []
        : matching([
            { value: ym(now), label: "This month", sublabel: ym(now) },
            { value: ym(new Date(now.getFullYear(), now.getMonth() - 1, 1)), label: "Last month", sublabel: ym(new Date(now.getFullYear(), now.getMonth() - 1, 1)) },
            { value: String(now.getFullYear()), label: "This year", sublabel: String(now.getFullYear()) },
          ]);
    default:
      return null;
  }
}

/** `input` with the operator being typed completed to `option` (quoted when it has spaces) and a trailing space. */
export function applyCompletion(input: string, ctx: CompletionContext, option: CompletionOption): string {
  const value = /\s/.test(option.value) ? `"${option.value}"` : option.value;
  return input.replace(/([a-z]+):("[^"]*|[^\s"]*)$/i, `${ctx.operator}:${value} `);
}

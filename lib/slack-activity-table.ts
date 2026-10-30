import { DEFAULT_PAGE_SIZE, parsePageParam, parsePageSizeParam, parseSortParams } from "@/lib/pagination";
import type { SortConfig } from "@/lib/hooks/useTableSort";

// The member page's Slack tab pages on the server: ?type=&channel=&sort=&dir=&page=&pageSize=.
// A plain module so the page, the repository and the client panel share the names.

export const SLACK_SORT_COLUMNS = ["type", "channel", "content", "date"] as const;
export type SlackSortColumn = (typeof SLACK_SORT_COLUMNS)[number];
export const DEFAULT_SLACK_SORT: SortConfig<SlackSortColumn> = { column: "date", direction: "desc" };

export const SLACK_KIND_FILTERS = ["all", "messages", "reactions"] as const;
export type SlackKindFilter = (typeof SLACK_KIND_FILTERS)[number];

export interface SlackPageQuery {
  kind: SlackKindFilter;
  channel: string | null;
  sort: SortConfig<SlackSortColumn>;
  page: number;
  pageSize: number;
}

type Params = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseSlackPageQuery(params: Params): SlackPageQuery {
  const kind = one(params.type);
  return {
    kind: (SLACK_KIND_FILTERS as readonly string[]).includes(kind ?? "") ? (kind as SlackKindFilter) : "all",
    channel: one(params.channel) || null,
    sort: parseSortParams(params.sort, params.dir, SLACK_SORT_COLUMNS, DEFAULT_SLACK_SORT) ?? DEFAULT_SLACK_SORT,
    page: parsePageParam(params.page),
    pageSize: parsePageSizeParam(params.pageSize, DEFAULT_PAGE_SIZE),
  };
}

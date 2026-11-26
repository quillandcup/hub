/**
 * Reading a quiz's submissions by id (docs/product/COURSES.md, "Importing past quiz responses"): the Results list API gives every
 * submission's id (`GET /api/admin/quizzes/:id/results`, JSON:API with a `meta` of `currentPage`, `pageCount`, `itemsTotalCount`) and one
 * submission is `GET /api/admin/quizzes/:id/results/:id`. The capture fetches both from inside the owner's logged-in Kajabi page (the
 * same session the page uses, GET only), so no button has to be clicked and nothing depends on a list coming back after "go back".
 *
 * This module is the part that needs no browser: it is given a way to GET one same-origin path and returns what was read. Paging the
 * list is the one guess: the page parameter is not known, so it tries the JSON:API style (`page[number]=N`) and then `page=N`, and
 * accepts one only when the answer's own `meta.currentPage` is N; otherwise it stops and says it could not page, never loops.
 *
 * Nothing here prints or returns a name, an email or an answer. Relative imports only: the script that calls this runs outside Next.
 */

import { forwardableHeaders } from "./progress-capture";
import { isObj, keyText } from "./quiz-capture";
import { pageMetaOf, submissionsListedIn, type PageMeta } from "./quiz-responses";
import type { QuizRead } from "./quiz-responses-run";

/** One same-origin GET from inside the logged-in page: the status and the JSON body (null when it wasn't JSON), or null when the request itself failed. */
export interface PageFetcher {
  getJson(path: string): Promise<{ status: number; json: unknown } | null>;
}

/** The Kajabi login is no longer valid (the API answered 401). */
export class FetchSessionExpiredError extends Error {}

const LOGIN_EXPIRED = "Kajabi answered 401: the login expired. Run again and log in.";

/** One request the logged-in page itself made to Kajabi's admin API: its path and the headers it carried. */
export interface SeenAdminRequest {
  path: string;
  headers: Record<string, string>;
}

const isListPath = (path: string): boolean => /^\/api\/admin\/quizzes\/[^/]+\/results\/?$/.test(path);

/**
 * Which of the page's own request headers our in-page GETs replay: everything `forwardableHeaders` keeps (an authorization or CSRF header,
 * the app's `x-*` headers; never cookie, host or what the browser sets itself), from the page's `/api/admin/` requests only, the Results
 * list request last so its values win. `accept` is left out (the capture sets it). `names` is what may be printed; the values are secrets
 * and must never be logged, stored or put in an error.
 */
export function chooseReplayHeaders(seen: SeenAdminRequest[]): { headers: Record<string, string>; names: string[] } {
  const admin = seen.filter((r) => r.path.startsWith("/api/admin/"));
  const ordered = [...admin.filter((r) => !isListPath(r.path)), ...admin.filter((r) => isListPath(r.path))];
  const headers: Record<string, string> = {};
  for (const request of ordered) Object.assign(headers, forwardableHeaders(request.headers));
  delete headers.accept;
  return { headers, names: Object.keys(headers).sort() };
}

/** Whether the page made the Results list request itself, the one the headers are copied from. */
export const sawResultsListRequest = (seen: SeenAdminRequest[]): boolean => seen.some((r) => isListPath(r.path));

/** The line that says which headers are replayed: names only. */
export const replayingHeadersLine = (names: string[]): string => `replaying headers: ${names.length > 0 ? names.join(", ") : "none beyond the cookie"}`;

/**
 * What a 401 on a replayed fetch means. If the page's own load was refused or sent to the login, the login expired; if the page loaded
 * fine and only our copy of its request was refused, the owner is logged in and must not be told to log in again.
 */
export function refusalMessage(context: { pageStatus: number | null; loginRedirect: boolean; headerNames: string[] }): string {
  if (context.loginRedirect || context.pageStatus === 401) return LOGIN_EXPIRED;
  const names = context.headerNames.length > 0 ? context.headerNames.join(", ") : "none beyond the cookie";
  return `Kajabi refused the capture's request even with the page's headers (names: ${names}). The page itself loaded, so the login is fine.`;
}

/** The most pages of one Results list that are read. */
export const MAX_LIST_PAGES = 200;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type PagingNote = "single_page" | "paged" | "could_not_page" | "page_limit";

export interface ListedSubmissions {
  /** Every submission id the list gave, once each, in the order seen. */
  ids: string[];
  /** The list's own count of all rows, when it says. */
  total: number | null;
  pages: number;
  paging: PagingNote;
  /** The list answered. False when the first request failed (nothing is known about the quiz). */
  ok: boolean;
}

const rowIds = (json: unknown): string[] => {
  const data = isObj(json) ? json.data : undefined;
  const fromData = Array.isArray(data) ? data.flatMap((row) => (isObj(row) ? [keyText(row.id)] : [])).filter((id): id is string => id !== null) : [];
  // A list of another shape: the rows that carry a responder.
  return fromData.length > 0 ? fromData : submissionsListedIn([json]).map((r) => r.submissionKey);
};

const checked = (response: { status: number; json: unknown } | null) => {
  if (response?.status === 401) throw new FetchSessionExpiredError(LOGIN_EXPIRED);
  return response && response.status >= 200 && response.status < 300 ? response : null;
};

/** The page parameters to try for page `n`, in order: JSON:API style first. */
export const pageParams = (n: number): string[] => [`page[number]=${n}`, `page=${n}`];

/** Reads the whole Results list of a quiz, page by page, by the list's own paging. */
export async function listSubmissionIds(fetcher: PageFetcher, quizId: string): Promise<ListedSubmissions> {
  const base = `/api/admin/quizzes/${quizId}/results`;
  const out: ListedSubmissions = { ids: [], total: null, pages: 0, paging: "single_page", ok: false };
  if (!SAFE_ID.test(quizId)) return out;
  const first = checked(await fetcher.getJson(base));
  if (!first) return out;
  out.ok = true;
  out.pages = 1;
  const seen = new Set<string>();
  const add = (json: unknown) => {
    for (const id of rowIds(json)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.ids.push(id);
      }
    }
  };
  add(first.json);
  const meta: PageMeta | null = pageMetaOf([first.json]);
  out.total = meta?.itemsTotalCount ?? null;
  if (!meta || meta.pageCount <= 1) return out;

  out.paging = "paged";
  let style: number | null = null;
  const last = Math.min(meta.pageCount, MAX_LIST_PAGES);
  for (let n = 2; n <= last; n++) {
    let accepted: { json: unknown } | null = null;
    // The style is settled on page 2 and kept; a page that doesn't say it is page n ends the reading.
    const tries: number[] = style === null ? [0, 1] : [style];
    for (const i of tries) {
      const response = checked(await fetcher.getJson(`${base}?${pageParams(n)[i]}`));
      if (response && pageMetaOf([response.json])?.currentPage === n) {
        style = i;
        accepted = response;
        break;
      }
    }
    if (!accepted) {
      out.paging = "could_not_page";
      return out;
    }
    out.pages++;
    add(accepted.json);
  }
  if (meta.pageCount > MAX_LIST_PAGES) out.paging = "page_limit";
  return out;
}

/**
 * Reads every submission of a quiz by id. `listed` is the list's own total when it says (else the ids it gave); a listed submission that
 * could not be fetched counts as failed; `incomplete` says the list could not be read to the end or the total was not reached.
 * Null when the list itself could not be read (the caller may fall back to opening rows).
 */
export async function readQuizByIds(fetcher: PageFetcher, quizId: string): Promise<(QuizRead & { paging: PagingNote; pages: number }) | null> {
  const list = await listSubmissionIds(fetcher, quizId);
  if (!list.ok) return null;
  const read: QuizRead & { paging: PagingNote; pages: number } = { listed: list.total ?? list.ids.length, submissions: [], failed: 0, incomplete: false, paging: list.paging, pages: list.pages };
  for (const id of list.ids) {
    if (!SAFE_ID.test(id)) {
      read.failed++;
      continue;
    }
    const response = checked(await fetcher.getJson(`/api/admin/quizzes/${quizId}/results/${id}`));
    if (response && response.json !== null) read.submissions.push({ key: id, documents: [response.json] });
    else read.failed++;
  }
  read.incomplete = list.paging === "could_not_page" || list.paging === "page_limit" || list.ids.length < (list.total ?? 0);
  return read;
}

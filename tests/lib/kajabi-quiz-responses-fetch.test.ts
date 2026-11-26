/** Reading a quiz's submissions by id from the list API, without a browser: a fake page answers GETs. Every value is invented. */
import { describe, expect, it } from "vitest";
import { FetchSessionExpiredError, MAX_LIST_PAGES, chooseReplayHeaders, listSubmissionIds, pageParams, readQuizByIds, refusalMessage, replayingHeadersLine, sawResultsListRequest, type PageFetcher } from "@/lib/kajabi/quiz-responses-fetch";

const QUIZ = "489124";

const row = (id: string) => ({ id, type: "quiz_results", attributes: { contactEmail: `r${id}@example.test`, contactName: "Someone", dateSubmittedAt: "2026-05-10T22:38:00.000Z" }, relationships: { answers: {}, quiz: { data: { id: QUIZ, type: "quizzes" } } } });
const page = (ids: string[], currentPage: number, pageCount: number, itemsTotalCount: number) => ({ data: ids.map(row), meta: { currentPage, itemsTotalCount, pageCount, pageSize: null } });
const submission = (id: string) => ({ data: row(id), included: [{ id: `a${id}`, type: "quiz_result_answers", attributes: { answer: "words", questionTitle: "Q", questionPosition: 1, questionType: "short_answer", fileUrl: null } }] });

/**
 * A server with three pages of two rows, that understands only the page parameter named in `understands` (others are ignored and
 * answer page 1), and answers a submission by id unless it is in `broken`.
 */
function server(opts: { understands: "page[number]" | "page" | "none"; broken?: string[]; status?: number; pages?: number; rowsPerPage?: number } = { understands: "page[number]" }) {
  const calls: string[] = [];
  const pageCount = opts.pages ?? 3;
  const per = opts.rowsPerPage ?? 2;
  const fetcher: PageFetcher = {
    async getJson(path) {
      calls.push(path);
      if (opts.status) return { status: opts.status, json: null };
      const url = new URL(path, "https://app.example.test");
      const m = /^\/api\/admin\/quizzes\/([^/]+)\/results(?:\/([^/]+))?$/.exec(url.pathname);
      if (!m) return null;
      if (m[2]) return opts.broken?.includes(m[2]) ? { status: 500, json: null } : { status: 200, json: submission(m[2]) };
      const asked = Number(url.searchParams.get(opts.understands === "page[number]" ? "page[number]" : opts.understands === "page" ? "page" : "never") ?? 1);
      const n = Number.isFinite(asked) && asked >= 1 && asked <= pageCount ? asked : 1;
      const ids = Array.from({ length: per }, (_, i) => String((n - 1) * per + i + 1));
      return { status: 200, json: page(ids, n, pageCount, pageCount * per) };
    },
  };
  return { fetcher, calls };
}

describe("listSubmissionIds", () => {
  it("reads every page with the JSON:API parameter and keeps it for the rest", async () => {
    const { fetcher, calls } = server();
    const list = await listSubmissionIds(fetcher, QUIZ);
    expect(list).toMatchObject({ ids: ["1", "2", "3", "4", "5", "6"], total: 6, pages: 3, paging: "paged", ok: true });
    expect(calls).toEqual([`/api/admin/quizzes/${QUIZ}/results`, `/api/admin/quizzes/${QUIZ}/results?page[number]=2`, `/api/admin/quizzes/${QUIZ}/results?page[number]=3`]);
  });

  it("falls back to page=N when the first style isn't honoured, and then keeps that one", async () => {
    const { fetcher, calls } = server({ understands: "page" });
    const list = await listSubmissionIds(fetcher, QUIZ);
    expect(list.ids).toHaveLength(6);
    expect(list.paging).toBe("paged");
    expect(calls.filter((c) => c.includes("page[number]"))).toHaveLength(1);
    expect(calls.filter((c) => /[?]page=/.test(c))).toHaveLength(2);
  });

  it("accepts a parameter only when the answer says it is that page: a server that ignores both stops, says so, and never loops", async () => {
    const { fetcher, calls } = server({ understands: "none" });
    const list = await listSubmissionIds(fetcher, QUIZ);
    expect(list).toMatchObject({ ids: ["1", "2"], pages: 1, paging: "could_not_page", total: 6 });
    expect(calls).toHaveLength(3);
  });

  it("stops when a later page is not the page asked for", async () => {
    const calls: string[] = [];
    const fetcher: PageFetcher = {
      async getJson(path) {
        calls.push(path);
        return { status: 200, json: path.includes("page[number]=3") ? page(["1", "2"], 1, 3, 6) : page(path.includes("page[number]=2") ? ["3", "4"] : ["1", "2"], path.includes("page[number]=2") ? 2 : 1, 3, 6) };
      },
    };
    const list = await listSubmissionIds(fetcher, QUIZ);
    expect(list).toMatchObject({ ids: ["1", "2", "3", "4"], paging: "could_not_page" });
    expect(calls).toHaveLength(3);
  });

  it("is one page when the list says so, or says nothing about paging", async () => {
    expect(await listSubmissionIds({ getJson: async () => ({ status: 200, json: page(["1"], 1, 1, 1) }) }, QUIZ)).toMatchObject({ ids: ["1"], paging: "single_page", total: 1 });
    expect(await listSubmissionIds({ getJson: async () => ({ status: 200, json: { data: [row("7"), row("8")] } }) }, QUIZ)).toMatchObject({ ids: ["7", "8"], paging: "single_page", total: null });
  });

  it("stops at the page limit and says so", async () => {
    const { fetcher, calls } = server({ understands: "page[number]", pages: MAX_LIST_PAGES + 50, rowsPerPage: 1 });
    const list = await listSubmissionIds(fetcher, QUIZ);
    expect(list.paging).toBe("page_limit");
    expect(list.pages).toBe(MAX_LIST_PAGES);
    expect(calls.length).toBeLessThanOrEqual(MAX_LIST_PAGES + 1);
  });

  it("is not ok when the list can't be fetched, throws for an expired login, and refuses an id that isn't plain", async () => {
    expect((await listSubmissionIds(server({ understands: "none", status: 404 }).fetcher, QUIZ)).ok).toBe(false);
    expect((await listSubmissionIds({ getJson: async () => null }, QUIZ)).ok).toBe(false);
    await expect(listSubmissionIds(server({ understands: "none", status: 401 }).fetcher, QUIZ)).rejects.toBeInstanceOf(FetchSessionExpiredError);
    const untouched = server();
    expect((await listSubmissionIds(untouched.fetcher, "1/../../x")).ok).toBe(false);
    expect(untouched.calls).toEqual([]);
  });

  it("lists a repeated id once", async () => {
    const list = await listSubmissionIds({ getJson: async () => ({ status: 200, json: page(["1", "1", "2"], 1, 1, 3) }) }, QUIZ);
    expect(list.ids).toEqual(["1", "2"]);
  });

  it("names the parameters in the order it tries them", () => {
    expect(pageParams(4)).toEqual(["page[number]=4", "page=4"]);
  });
});

describe("readQuizByIds", () => {
  it("fetches every submission by id: listed and read reconcile", async () => {
    const { fetcher, calls } = server();
    const read = (await readQuizByIds(fetcher, QUIZ))!;
    expect(read).toMatchObject({ listed: 6, failed: 0, incomplete: false, paging: "paged", pages: 3 });
    expect(read.submissions.map((s) => s.key)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(calls.filter((c) => /results\/\d+$/.test(c))).toHaveLength(6);
    // GET paths on the quiz's own API only.
    expect(calls.every((c) => c.startsWith(`/api/admin/quizzes/${QUIZ}/results`))).toBe(true);
  });

  it("counts a submission that can't be fetched as failed, not as read", async () => {
    const read = (await readQuizByIds(server({ understands: "page[number]", broken: ["3"] }).fetcher, QUIZ))!;
    expect(read.failed).toBe(1);
    expect(read.submissions).toHaveLength(5);
    expect(read.listed).toBe(read.submissions.length + read.failed);
  });

  it("says it is incomplete, with listed more than was read, when the list could not be paged", async () => {
    const read = (await readQuizByIds(server({ understands: "none" }).fetcher, QUIZ))!;
    expect(read).toMatchObject({ listed: 6, incomplete: true, paging: "could_not_page" });
    expect(read.submissions).toHaveLength(2);
  });

  it("is null when the list can't be read, so the caller can fall back", async () => {
    expect(await readQuizByIds(server({ understands: "none", status: 404 }).fetcher, QUIZ)).toBeNull();
  });

  it("skips an id that isn't plain without fetching it", async () => {
    const calls: string[] = [];
    const fetcher: PageFetcher = {
      async getJson(path) {
        calls.push(path);
        return { status: 200, json: page(["ok1", "../../etc"], 1, 1, 2) };
      },
    };
    const read = (await readQuizByIds(fetcher, QUIZ))!;
    expect(read.failed).toBe(1);
    expect(calls.some((c) => c.includes(".."))).toBe(false);
  });
});

describe("chooseReplayHeaders", () => {
  const list = `/api/admin/quizzes/${QUIZ}/results`;

  it("drops cookie and host, keeps authorization and csrf headers, and never returns accept", () => {
    const { headers, names } = chooseReplayHeaders([
      { path: list, headers: { Cookie: "session=fake", Host: "app.example.test", Authorization: "Bearer fake-token", "X-CSRF-Token": "fake-csrf", Accept: "text/html", "sec-fetch-mode": "cors", "User-Agent": "x" } },
    ]);
    expect(headers).toEqual({ authorization: "Bearer fake-token", "x-csrf-token": "fake-csrf" });
    expect(names).toEqual(["authorization", "x-csrf-token"]);
  });

  it("takes headers from every admin request and lets the results list request win", () => {
    const { headers } = chooseReplayHeaders([
      { path: list, headers: { authorization: "list", "x-a": "1" } },
      { path: "/api/admin/other", headers: { authorization: "other", "x-b": "2" } },
      { path: "/api/client/elsewhere", headers: { "x-c": "3" } },
    ]);
    expect(headers).toEqual({ authorization: "list", "x-a": "1", "x-b": "2" });
  });

  it("is empty when no admin request was seen, and the printed line never holds a value", () => {
    expect(chooseReplayHeaders([])).toEqual({ headers: {}, names: [] });
    expect(chooseReplayHeaders([{ path: "/api/client/x", headers: { authorization: "a" } }]).names).toEqual([]);
    const line = replayingHeadersLine(chooseReplayHeaders([{ path: list, headers: { authorization: "secret-value" } }]).names);
    expect(line).toBe("replaying headers: authorization");
    expect(line).not.toContain("secret-value");
    expect(replayingHeadersLine([])).toBe("replaying headers: none beyond the cookie");
  });

  it("knows whether the page made the results list request", () => {
    expect(sawResultsListRequest([{ path: list, headers: {} }])).toBe(true);
    expect(sawResultsListRequest([{ path: `${list}/abc`, headers: {} }, { path: "/api/admin/x", headers: {} }])).toBe(false);
  });
});

describe("refusalMessage", () => {
  it("says the login expired when the page's own request was 401 or went to a login", () => {
    expect(refusalMessage({ pageStatus: 401, loginRedirect: false, headerNames: ["authorization"] })).toMatch(/login expired/);
    expect(refusalMessage({ pageStatus: 200, loginRedirect: true, headerNames: [] })).toMatch(/login expired/);
  });

  it("says the capture was refused, with header names, when the page itself loaded fine", () => {
    const message = refusalMessage({ pageStatus: 200, loginRedirect: false, headerNames: ["authorization", "x-csrf-token"] });
    expect(message).toContain("refused the capture's request even with the page's headers (names: authorization, x-csrf-token)");
    expect(message).not.toMatch(/log in/);
    expect(refusalMessage({ pageStatus: null, loginRedirect: false, headerNames: [] })).toContain("none beyond the cookie");
  });
});

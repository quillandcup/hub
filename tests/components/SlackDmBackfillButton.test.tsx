// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import SlackDmBackfillButton, { MAX_BACKFILL_RUNS, MAX_STALLED_RUNS } from "@/app/(admin)/admin/data/import/SlackDmBackfillButton";

const run = (extra: Record<string, unknown> = {}) => ({ members: 4, conversations: 10, messages: 20, deferred: 0, incomplete: 0, errors: [] as string[], ...extra });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function stubRuns(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const click = () => userEvent.setup().click(screen.getByRole("button", { name: "Pull everyone's DMs" }));

afterEach(() => vi.unstubAllGlobals());

describe("SlackDmBackfillButton", () => {
  it("repeats the run until nobody is deferred or partly read, and adds the runs up", async () => {
    const fetchMock = stubRuns(ok(run({ deferred: 3, incomplete: 1 })), ok(run({ deferred: 0, incomplete: 1, conversations: 5, messages: 7 })), ok(run({ conversations: 2, messages: 1 })));
    render(<SlackDmBackfillButton />);
    await click();
    await waitFor(() => expect(screen.getByText(/Everyone is read/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith("/api/reconcile/slack-dms?backfill=1");
    expect(screen.getByRole("status")).toHaveTextContent("17 conversations and 28 messages so far");
    expect(screen.getByText(/3 runs/)).toBeInTheDocument();
  });

  it("lists the errors every run reported", async () => {
    stubRuns(ok(run({ incomplete: 1, errors: ["member x: boom"] })), ok(run({ errors: ["member y: bang"] })));
    render(<SlackDmBackfillButton />);
    await click();
    await waitFor(() => expect(screen.getByText("2 errors")).toBeInTheDocument());
    expect(screen.getByText("member x: boom")).toBeInTheDocument();
    expect(screen.getByText("member y: bang")).toBeInTheDocument();
  });

  it("says so off production and stops", async () => {
    const fetchMock = stubRuns(ok({ success: true, skipped: "not production" }));
    render(<SlackDmBackfillButton />);
    await click();
    await waitFor(() => expect(screen.getByText("Nothing to do: not production.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message when a run fails", async () => {
    stubRuns({ ok: false, status: 500, json: async () => ({ error: "db down" }) });
    render(<SlackDmBackfillButton />);
    await click();
    await waitFor(() => expect(screen.getByText("db down")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Pull everyone's DMs" })).toBeEnabled();
  });

  it("gives up after several runs in a row that read nothing", async () => {
    const stalled = ok(run({ deferred: 2, conversations: 0, messages: 0 }));
    const fetchMock = stubRuns(...Array.from({ length: MAX_STALLED_RUNS + 2 }, () => stalled));
    render(<SlackDmBackfillButton />);
    await click();
    await waitFor(() => expect(screen.getByText(/runs in a row read nothing/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(MAX_STALLED_RUNS);
  });

  it("stops after the current run when asked", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let release: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    render(<SlackDmBackfillButton />);
    await click();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Stop after this run" }));
    release(ok(run({ deferred: 2 })));
    await waitFor(() => expect(screen.getByText(/Stopped\. Run it again/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pauses at the most runs one click makes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(run({ deferred: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<SlackDmBackfillButton />);
    await click();
    await waitFor(() => expect(screen.getByText(new RegExp(`Paused after ${MAX_BACKFILL_RUNS} runs`))).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(MAX_BACKFILL_RUNS);
  });
});

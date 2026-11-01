// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ProductProgressImportForm from "@/app/(admin)/admin/data/import/ProductProgressImportForm";

const COURSES = [
  { kajabiId: "c1", title: "Self-Editing Example" },
  { kajabiId: "c2", title: "Another Example" },
];

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submit() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Course the report is for"), "c2");
  await user.upload(screen.getByLabelText("Product Progress CSV"), new File(["Email,Product Progress\n"], "progress.csv", { type: "text/csv" }));
  // jsdom does not count a file set by userEvent as satisfying `required`, so submit the form directly.
  fireEvent.submit(screen.getByRole("button", { name: "Import progress" }).closest("form")!);
}

afterEach(() => vi.unstubAllGlobals());

describe("ProductProgressImportForm", () => {
  it("says to import the courses first when there are none", () => {
    render(<ProductProgressImportForm courses={[]} />);
    expect(screen.getByText(/No Kajabi courses are imported yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists the courses and posts the chosen course and file", async () => {
    const fetchMock = respond(200, { rowsRead: 5, imported: 5, written: 3, unchanged: 2, removed: 1, matched: 3, ambiguous: 1, unmatched: 1, unmatchedEmails: ["ghost@example.com"] });
    render(<ProductProgressImportForm courses={COURSES} />);
    expect(screen.getByRole("option", { name: "Self-Editing Example" })).toBeInTheDocument();
    await submit();

    await waitFor(() => expect(screen.getByText("Import successful")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/import/kajabi-product-progress");
    const form = init.body as FormData;
    expect(form.get("courseId")).toBe("c2");
    expect(form.has("file")).toBe(true);
    expect(screen.getByText(/5 rows read, 5 imported \(3 new or changed, 2 unchanged\)/)).toBeInTheDocument();
    expect(screen.getByText("1 no longer in the report")).toBeInTheDocument();
    expect(screen.getByText("3 matched to a member by email")).toBeInTheDocument();
    expect(screen.getByText("1 ambiguous (one email, several members)")).toBeInTheDocument();
    expect(screen.getByText("1 unmatched")).toBeInTheDocument();
    expect(screen.getByText("ghost@example.com")).toBeInTheDocument();
  });

  it("shows invalid rows with their line numbers and how many more there are", async () => {
    respond(422, {
      error: "3 of 9 rows could not be read, so nothing was imported.",
      invalidCount: 3,
      invalid: [
        { line: 4, reason: "Email is not a valid address" },
        { line: 7, reason: "Logins is not a whole number" },
      ],
    });
    render(<ProductProgressImportForm courses={COURSES} />);
    await submit();

    await waitFor(() => expect(screen.getByText("Import failed")).toBeInTheDocument());
    expect(screen.getByText(/3 of 9 rows could not be read/)).toBeInTheDocument();
    expect(screen.getByText("Line 4: Email is not a valid address")).toBeInTheDocument();
    expect(screen.getByText("Line 7: Logins is not a whole number")).toBeInTheDocument();
    expect(screen.getByText("and 1 more")).toBeInTheDocument();
    expect(screen.queryByText("Import successful")).toBeNull();
  });

  it("shows a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ProductProgressImportForm courses={COURSES} />);
    await submit();
    await waitFor(() => expect(screen.getByText("offline")).toBeInTheDocument());
  });
});

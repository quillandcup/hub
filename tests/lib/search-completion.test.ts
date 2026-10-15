import { describe, it, expect } from "vitest";
import { applyCompletion, completionContext, staticOptions } from "@/lib/search/completion";

const now = new Date(2026, 9, 13); // 13 Oct 2026

describe("completionContext", () => {
  it("finds the operator being typed at the end of the box", () => {
    expect(completionContext("pizza from:an")).toEqual({ operator: "from", typed: "an" });
    expect(completionContext("in:")).toEqual({ operator: "in", typed: "" });
    expect(completionContext('from:"Ania R')).toEqual({ operator: "from", typed: "Ania R" });
  });

  it("is not completing once the value is finished or the operator is unknown", () => {
    expect(completionContext("from:me ")).toBeNull();
    expect(completionContext("https://example.com")).toBeNull();
    expect(completionContext("email:bob")).toBeNull();
    expect(completionContext("plain words")).toBeNull();
  });
});

describe("staticOptions", () => {
  const options = (input: string) => staticOptions(completionContext(input)!, now)?.map((o) => o.value);

  it("offers the kinds that match, by name or label", () => {
    expect(options("in:pr")).toEqual(["prickles", "projects"]);
    expect(options("in:")).toContain("pages");
  });

  it("offers has: and is: values", () => {
    expect(options("has:")).toEqual(["link", "file", "reaction"]);
    expect(options("has:l")).toEqual(["link"]);
    expect(options("is:")).toEqual(["thread"]);
  });

  it("offers dates relative to today, and steps aside when a date is typed", () => {
    expect(options("after:")).toEqual(["2026-10-13", "2026-10-12", "2026-10-06", "2026-09-13"]);
    expect(options("during:")).toEqual(["2026-10", "2026-09", "2026"]);
    expect(options("after:2026")).toEqual([]);
  });

  it("leaves from: and channel: to the server", () => {
    expect(options("from:an")).toBeUndefined();
    expect(options("channel:ge")).toBeUndefined();
  });
});

describe("applyCompletion", () => {
  it("replaces the half-typed value and adds a space", () => {
    const ctx = completionContext("pizza in:pr")!;
    expect(applyCompletion("pizza in:pr", ctx, { value: "prickles", label: "Prickles" })).toBe("pizza in:prickles ");
  });

  it("quotes a value with spaces", () => {
    const ctx = completionContext("from:an")!;
    expect(applyCompletion("from:an", ctx, { value: "Ania Ray", label: "Ania" })).toBe('from:"Ania Ray" ');
  });
});

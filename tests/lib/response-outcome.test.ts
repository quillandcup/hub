import { describe, expect, it } from "vitest";
import { responseOutcome } from "@/lib/analytics/outcome";

describe("responseOutcome", () => {
  it("counts a response under 400 as worked, with no detail", () => {
    expect(responseOutcome(new Response("{}", { status: 200 }))).toEqual({ ok: true });
    expect(responseOutcome(new Response(null, { status: 204 }))).toEqual({ ok: true });
    expect(responseOutcome(new Response(null, { status: 302 }))).toEqual({ ok: true });
  });

  it("counts a refusal or a failure as not worked, and says which status", () => {
    expect(responseOutcome(new Response("{}", { status: 400 }))).toEqual({ ok: false, detail: "400" });
    expect(responseOutcome(new Response("{}", { status: 403 }))).toEqual({ ok: false, detail: "403" });
    expect(responseOutcome(new Response("{}", { status: 500 }))).toEqual({ ok: false, detail: "500" });
  });
});

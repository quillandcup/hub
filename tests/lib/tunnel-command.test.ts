import { describe, it, expect } from "vitest";
import { planTunnel } from "@/scripts/tunnel-command";

describe("planTunnel", () => {
  it("prefers ngrok when both are installed, on Next's default port", () => {
    expect(planTunnel(["cloudflared", "ngrok"], [])).toEqual({
      ok: true,
      command: { tool: "ngrok", args: ["http", "3000"] },
    });
  });

  it("uses a reserved ngrok domain so the address stays the same between runs", () => {
    expect(planTunnel(["ngrok"], ["3107"], "hub-dev.ngrok.app")).toEqual({
      ok: true,
      command: { tool: "ngrok", args: ["http", "3107", "--url=https://hub-dev.ngrok.app"] },
    });
  });

  it("falls back to cloudflared, ignoring a domain it can't use", () => {
    expect(planTunnel(["cloudflared"], ["3107"], "hub-dev.ngrok.app")).toEqual({
      ok: true,
      command: { tool: "cloudflared", args: ["tunnel", "--url", "http://localhost:3107"] },
    });
  });

  it("says how to install one when neither is available", () => {
    const plan = planTunnel([], []);
    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.error).toContain("brew install");
  });

  it.each([["abc"], ["0"], ["70000"], ["3000", "3001"], ["3000.5"]])("rejects the port arguments %j", (...argv) => {
    const plan = planTunnel(["ngrok"], argv);
    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.error).toContain("Usage:");
  });
});

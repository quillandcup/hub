import { describe, it, expect } from "vitest";
import { planTunnel } from "@/scripts/tunnel-command";

describe("planTunnel", () => {
  it("tunnels Next's default port", () => {
    expect(planTunnel(true, [])).toEqual({ ok: true, command: { tool: "ngrok", args: ["http", "3000"] } });
  });

  it("tunnels another port", () => {
    expect(planTunnel(true, ["3107"])).toEqual({ ok: true, command: { tool: "ngrok", args: ["http", "3107"] } });
  });

  it("uses a reserved domain so the address stays the same between runs", () => {
    expect(planTunnel(true, ["3107"], "hub-dev.ngrok.app")).toEqual({
      ok: true,
      command: { tool: "ngrok", args: ["http", "3107", "--url=https://hub-dev.ngrok.app"] },
    });
  });

  it("says how to install ngrok when it's missing", () => {
    const plan = planTunnel(false, []);
    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.error).toContain("brew install ngrok");
  });

  it.each([["abc"], ["0"], ["70000"], ["3000", "3001"], ["3000.5"]])("rejects the port arguments %j", (...argv) => {
    const plan = planTunnel(true, argv);
    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.error).toContain("Usage:");
  });
});

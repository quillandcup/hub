import { describe, it, expect } from "vitest";
import { planTunnel } from "@/scripts/tunnel-command";

describe("planTunnel", () => {
  it("tunnels Next's default port", () => {
    expect(planTunnel(true, [])).toEqual({ ok: true, command: { tool: "ngrok", args: ["http", "3000"] } });
  });

  it("tunnels another port", () => {
    expect(planTunnel(true, ["3107"])).toEqual({ ok: true, command: { tool: "ngrok", args: ["http", "3107"] } });
  });

  it("starts a named endpoint from the ngrok config, which holds its own domain and port", () => {
    expect(planTunnel(true, [], "hedgie-hub")).toEqual({
      ok: true,
      command: { tool: "ngrok", args: ["start", "hedgie-hub"] },
    });
  });

  it("refuses a port argument alongside a named endpoint, since the endpoint sets the port", () => {
    const plan = planTunnel(true, ["3107"], "hedgie-hub");
    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.error).toContain("Unset TUNNEL_ENDPOINT");
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

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GATES, RETURN_PARAM, afterGate, gateHref, returnToParam, type Gate } from "@/lib/gates";
import { safeNextPath } from "@/lib/safe-next";

const DESTINATION = "/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1";
const entries = Object.entries(GATES) as [string, Gate][];

describe("gateHref", () => {
  it("attaches the destination, keeping the gate's own parameters", () => {
    const url = new URL(`http://x${gateHref(GATES.connectSlack, DESTINATION)}`);

    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("slack")).toBe("required");
    expect(url.searchParams.get(RETURN_PARAM)).toBe(DESTINATION);
  });

  it("leaves the destination off when it isn't a safe same-origin path, or is the gate's own page", () => {
    for (const bad of [null, undefined, "", "https://evil.example.com/", "//evil.example.com", "/\\evil", "/login", "/auth/callback", "/settings", "/settings?tab=hosting"]) {
      expect(gateHref(GATES.connectSlack, bad)).toBe("/settings?slack=required");
    }
  });
});

describe("returnToParam and afterGate", () => {
  it("accept only safe same-origin paths", () => {
    expect(returnToParam(DESTINATION)).toBe(DESTINATION);
    expect(returnToParam("https://evil.example.com")).toBeNull();
    expect(returnToParam(null)).toBeNull();
  });

  it("send the visitor to their destination once the gate is done, else to the fallback, and never back to the gate", () => {
    expect(afterGate(GATES.connectSlack, DESTINATION, "/settings?slack=connected")).toBe(DESTINATION);
    expect(afterGate(GATES.connectSlack, null, "/settings?slack=connected")).toBe("/settings?slack=connected");
    expect(afterGate(GATES.connectSlack, "https://evil.example.com", "/dashboard")).toBe("/dashboard");
    expect(afterGate(GATES.connectSlack, "/settings?slack=required", "/dashboard")).toBe("/dashboard");
  });
});

describe.each(entries)("the %s gate follows the standard (.claude/rules/gates-and-return-to.md)", (_key, gate) => {
  it("names itself, its page, why it stops the visitor, and a decline fallback", () => {
    expect(gate.id).toMatch(/^[a-z][a-z-]+$/);
    expect(gate.path.startsWith("/")).toBe(true);
    expect(gate.reason.length).toBeGreaterThan(10);
    expect(gate.declineLabel.length).toBeGreaterThan(0);
  });

  it("has an exit that is a safe path, is not the gate's own page, and is not itself gated", () => {
    expect(safeNextPath(gate.declineTo)).toBe(gate.declineTo);
    expect(gate.declineTo.split(/[?#]/, 1)[0]).not.toBe(gate.path);
    expect(entries.map(([, g]) => g.path)).not.toContain(gate.declineTo.split(/[?#]/, 1)[0]);
  });

  it("carries the destination to its page, and hands it back once it is done", () => {
    expect(new URL(`http://x${gateHref(gate, DESTINATION)}`).searchParams.get(RETURN_PARAM)).toBe(DESTINATION);
    expect(afterGate(gate, DESTINATION, gate.declineTo)).toBe(DESTINATION);
  });
});

/** Every file under `dir` (relative to the repo root) with one of the extensions, not node_modules. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(name)) found.push(path);
  }
  return found;
}

describe("every gate has a page that shows the way out", () => {
  const files = ["app", "components"].flatMap((d) => sourceFiles(d)).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it.each(entries)("%s: some page serves the gate and renders <GateExit>", (key) => {
    const serving = files.filter((f) => f.text.includes(`GATES.${key}`) && f.text.includes("<GateExit"));
    expect(serving.map((f) => f.path)).not.toHaveLength(0);
  });
});

describe("gates are redirected to through the registry", () => {
  const lib = sourceFiles("lib").concat(sourceFiles("app")).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it.each(entries)("%s: no code hand-writes a redirect to the gate's page with its parameters", (_key, gate) => {
    const literal = `${gate.path}?${new URLSearchParams(gate.params).toString()}`;
    const offenders = lib.filter((f) => f.text.includes(`redirect("${literal}`) || f.text.includes(`redirect('${literal}`) || f.text.includes(`redirect(\`${literal}`));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

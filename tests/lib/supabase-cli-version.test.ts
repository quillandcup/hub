import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// `pnpm types:gen` runs one pinned Supabase CLI so the generated lib/data/database.types.ts is the
// same on every machine and in CI (the generator formats its output differently from version to
// version), and CI's `types:check` regenerates it with that version. If the workflow's CLI pin moves,
// the script has to move with it, or the check fails on every run.
const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Supabase CLI version for generated types", () => {
  it("is the version CI pins", () => {
    const pinned = read(".github/workflows/ci.yml").match(/^\s*SUPABASE_CLI_VERSION:\s*([\d.]+)\s*$/m)?.[1];
    const generator = JSON.parse(read("package.json")).scripts["types:gen"] as string;

    expect(pinned, "SUPABASE_CLI_VERSION in .github/workflows/ci.yml").toMatch(/^\d+\.\d+\.\d+$/);
    expect(generator).toContain(`supabase@${pinned} gen types`);
  });

  it("is the same in the scheduled help screenshots workflow, which starts its own stack", () => {
    const pin = (file: string) => read(file).match(/^\s*SUPABASE_CLI_VERSION:\s*([\d.]+)\s*$/m)?.[1];
    expect(pin(".github/workflows/help-screenshots.yml")).toBe(pin(".github/workflows/ci.yml"));
  });

  it("is checked by CI after the local Supabase is up", () => {
    const ci = read(".github/workflows/ci.yml");

    const up = ci.indexOf("- name: Wait for local Supabase");
    const check = ci.indexOf("run: pnpm types:check");
    expect(up).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(up);
  });
});

import { describe, expect, it } from "vitest";
import { parseAdoptArgs } from "@/scripts/adopt-book-covers-args";

describe("parseAdoptArgs", () => {
  it("is a dry run on the local env file unless told otherwise", () => {
    expect(parseAdoptArgs([])).toEqual({ ok: true, envFile: ".env.local", apply: false });
  });

  it("takes --apply and an env file, with a space or an equals sign", () => {
    expect(parseAdoptArgs(["--apply", "--env", ".env.prod"])).toEqual({ ok: true, envFile: ".env.prod", apply: true });
    expect(parseAdoptArgs(["--env=.env.prod"])).toEqual({ ok: true, envFile: ".env.prod", apply: false });
  });

  it("refuses anything it doesn't understand, so a typo never turns a dry run into a write", () => {
    expect(parseAdoptArgs(["--aply"])).toEqual({ ok: false, error: "Unknown option: --aply" });
    expect(parseAdoptArgs(["extra"])).toEqual({ ok: false, error: "Unknown option: extra" });
    expect(parseAdoptArgs(["--env"])).toEqual({ ok: false, error: "--env needs a file name" });
    expect(parseAdoptArgs(["--env", "--apply"])).toEqual({ ok: false, error: "--env needs a file name" });
  });
});

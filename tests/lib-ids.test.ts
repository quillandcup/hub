import { describe, expect, it } from "vitest";
import { ID_PREFIXES, isAnyId, isId } from "@/lib/ids";

describe("isId", () => {
  it("accepts an id with the right prefix", () => {
    expect(isId("mbr_7Kx2mQ9dFh3N", "mbr")).toBe(true);
    expect(isId("photo_7Kx2mQ9dFh3N", "photo")).toBe(true);
  });

  it("rejects another prefix, a uuid, wrong length, characters outside base58 and empty values", () => {
    expect(isId("prkl_7Kx2mQ9dFh3N", "mbr")).toBe(false);
    expect(isId("0f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5", "mbr")).toBe(false);
    expect(isId("mbr_7Kx2mQ9dFh3", "mbr")).toBe(false);
    expect(isId("mbr_7Kx2mQ9dFh3NN", "mbr")).toBe(false);
    expect(isId("mbr_7Kx2mQ9dFh30", "mbr")).toBe(false);
    expect(isId("mbr_7Kx2mQ9dFh3l", "mbr")).toBe(false);
    expect(isId("", "mbr")).toBe(false);
    expect(isId(undefined, "mbr")).toBe(false);
  });
});

describe("isAnyId", () => {
  it("accepts every Tier 1 prefix and nothing else", () => {
    for (const p of ID_PREFIXES) expect(isAnyId(`${p}_7Kx2mQ9dFh3N`)).toBe(true);
    expect(isAnyId("zzz_7Kx2mQ9dFh3N")).toBe(false);
    expect(isAnyId("all")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readKajabiZip, ZIP_LIMITS } from "@/lib/landing/kajabi-zip";
import { exportZip, PNG_1X1 } from "@/tests/helpers/kajabi-export";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const settings = strToU8("{}");

describe("readKajabiZip", () => {
  it("reads the settings and the images, and nothing else", () => {
    const read = readKajabiZip(exportZip());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(text(read.settings)).toContain("current");
    expect([...read.images.keys()]).toEqual(["photo.png"]);
    expect(read.images.get("photo.png")).toEqual(PNG_1X1);
  });

  it("finds the files with or without the export's folder, and ignores macOS's resource entries", () => {
    const read = readKajabiZip(zipSync({ "config/settings_data.json": settings, "__MACOSX/config/settings_data.json": strToU8("not this"), "assets/a.jpg": PNG_1X1 }));
    expect(read.ok && text(read.settings)).toBe("{}");
  });

  it("refuses an archive with a path that climbs out, starts at the root or uses a backslash", () => {
    for (const name of ["../evil.txt", "a/../../evil.txt", "/etc/passwd", "a\\b.txt", "C:/x.txt"]) {
      const read = readKajabiZip(zipSync({ "config/settings_data.json": settings, [name]: strToU8("x") }));
      expect(read, name).toEqual({ ok: false, error: "That archive has a file name that isn't allowed." });
    }
  });

  it("refuses what is not a zip, an empty file, and one without the settings", () => {
    expect(readKajabiZip(new Uint8Array(0))).toMatchObject({ ok: false });
    expect(readKajabiZip(strToU8("just text"))).toEqual({ ok: false, error: "That isn't a zip file." });
    expect(readKajabiZip(zipSync({ "assets/a.png": PNG_1X1 }))).toMatchObject({ ok: false, error: expect.stringContaining("settings_data.json") });
    expect(readKajabiZip(Uint8Array.from([0x50, 0x4b, 1, 2, 3]))).toMatchObject({ ok: false });
  });

  it("stops a file that inflates past its limit, whatever its header says (a zip bomb)", () => {
    const bomb = zipSync({ "config/settings_data.json": new Uint8Array(3 * 1024 * 1024) });
    expect(bomb.byteLength).toBeLessThan(ZIP_LIMITS.archiveBytes);
    expect(readKajabiZip(bomb)).toEqual({ ok: false, error: "That archive is too large when unpacked." });
  });

  it("stops when everything together inflates past the total", () => {
    const image = new Uint8Array(ZIP_LIMITS.imageBytes - 1024);
    const files = Object.fromEntries([1, 2, 3, 4].map((n) => [`assets/${n}.png`, image]));
    expect(readKajabiZip(zipSync({ "config/settings_data.json": settings, ...files }))).toEqual({ ok: false, error: "That archive is too large when unpacked." });
  });

  it("does not inflate what it doesn't read, so a huge script costs nothing", () => {
    // Just over the total is enough: inflating it would trip the limit. Compressing it still takes a while on a busy runner, so the test gets more than the default 5s.
    const read = readKajabiZip(zipSync({ "config/settings_data.json": settings, "assets/scripts.js": new Uint8Array(ZIP_LIMITS.totalBytes + 1024) }));
    expect(read.ok).toBe(true);
  }, 30_000);

  it("refuses too many entries, and an upload larger than the cap", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`snippets/${i}.liquid`, strToU8("x")]));
    expect(readKajabiZip(zipSync({ "config/settings_data.json": settings, ...many }), { ...ZIP_LIMITS, entries: 10 })).toMatchObject({ ok: false });
    expect(readKajabiZip(exportZip(), { ...ZIP_LIMITS, archiveBytes: 10 })).toEqual({ ok: false, error: "That file is too large for a page export." });
  });
});

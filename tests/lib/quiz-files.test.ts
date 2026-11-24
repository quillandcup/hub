import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { QUIZ_ANSWERS } from "@/lib/config";
import { checkQuizFile, uploadTargetFrom, fileExtensionOf, isAttemptId, isOwnQuizFilePath, newQuizFilePath, safeQuizFileName } from "@/lib/courses/quiz-files";
import { quizFileSize, removeQuizFiles, signQuizFileUpload, signedQuizFileDownload } from "@/lib/courses/quiz-files-storage";
import type { SupabaseClient } from "@supabase/supabase-js";

const ADA = "mbr_AAAAAAAAAAA1";
const RANDOM = "11111111-1111-4111-8111-111111111111";

describe("checkQuizFile", () => {
  it("accepts a document or a picture within the limit, whatever the case of its extension", () => {
    expect(checkQuizFile("letter.pdf", 1000)).toEqual({ ok: true });
    expect(checkQuizFile("Scan.JPG", QUIZ_ANSWERS.maxFileBytes)).toEqual({ ok: true });
  });

  it("refuses an empty file, one over the limit, an unlisted kind, and no extension", () => {
    expect(checkQuizFile("a.pdf", 0)).toEqual({ ok: false, error: "That file is empty." });
    expect(checkQuizFile("a.pdf", QUIZ_ANSWERS.maxFileBytes + 1)).toEqual({ ok: false, error: "Files can be up to 10 MB." });
    expect(checkQuizFile("run.exe", 10)).toMatchObject({ ok: false });
    expect(checkQuizFile("noextension", 10)).toMatchObject({ ok: false });
    expect(checkQuizFile("", 10)).toMatchObject({ ok: false });
    expect(checkQuizFile("a.pdf", Number.NaN)).toMatchObject({ ok: false });
  });

  it("never accepts a program or script kind", () => {
    for (const ext of ["exe", "sh", "js", "html", "svg", "bat", "app", "php", "dmg"]) expect(checkQuizFile(`x.${ext}`, 10).ok).toBe(false);
  });
});

describe("paths", () => {
  it("puts a file in the member's own folder, under a random one, with a cleaned name", () => {
    expect(newQuizFilePath(ADA, "My Letter (final).pdf", RANDOM)).toBe(`${ADA}/${RANDOM}/My_Letter_final_.pdf`);
    expect(fileExtensionOf("a.b.PDF")).toBe("pdf");
    expect(fileExtensionOf("none")).toBe("");
  });

  it("recognizes only the paths it makes for this member", () => {
    const own = newQuizFilePath(ADA, "a.pdf", RANDOM);
    expect(isOwnQuizFilePath(ADA, own)).toBe(true);
    expect(isOwnQuizFilePath("mbr_BBBBBBBBBBB2", own)).toBe(false);
    for (const bad of [`${ADA}/${RANDOM}/../b.pdf`, `${ADA}/x/a.pdf`, `${ADA}/${RANDOM}/a b.pdf`, `${ADA}/${RANDOM}/`, `${ADA}/${RANDOM}/a.pdf/extra`, 5, null, undefined]) {
      expect(isOwnQuizFilePath(ADA, bad)).toBe(false);
    }
  });

  it("(property) any name becomes a path of the member's own that is accepted, and never reaches another folder", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (name) => {
        const path = newQuizFilePath(ADA, name, RANDOM);
        expect(isOwnQuizFilePath(ADA, path)).toBe(true);
        expect(path.startsWith(`${ADA}/${RANDOM}/`)).toBe(true);
        expect(path.split("/")).toHaveLength(3);
        expect(safeQuizFileName(name)).not.toMatch(/[^A-Za-z0-9._-]/);
      }),
      { numRuns: 300 },
    );
  });

  it("knows an attempt id", () => {
    expect(isAttemptId("qatt_AAAAAAAAAAAa")).toBe(true);
    for (const bad of ["qatt_short", "qques_AAAAAAAAAAAa", "qatt_AAAAAAAAAAAl", 3, null]) expect(isAttemptId(bad)).toBe(false);
  });
});

describe("uploadTargetFrom", () => {
  const path = `${ADA}/${RANDOM}/a.pdf`;
  it("accepts the shapes the server makes and nothing else", () => {
    expect(uploadTargetFrom(path, "tokentokentoken")).toEqual({ path, token: "tokentokentoken" });
    for (const bad of [["../x/y", "tokentokentoken"], [`${ADA}/${RANDOM}/../a.pdf`, "tokentokentoken"], [path, "short"], [path, "to ken to ken"], [path, "t".repeat(4001)], [5, "tokentokentoken"], [path, null], ["https://evil.test/x", "tokentokentoken"]]) {
      expect(uploadTargetFrom(bad[0], bad[1])).toBeNull();
    }
  });
});

/** A storage client that records what it was asked and answers as told. */
function fakeStorage(answers: { upload?: unknown; list?: unknown; signed?: unknown; remove?: unknown } = {}) {
  const bucket = {
    createSignedUploadUrl: vi.fn(async () => answers.upload ?? { data: { token: "tok" }, error: null }),
    list: vi.fn(async () => answers.list ?? { data: [], error: null }),
    createSignedUrl: vi.fn(async () => answers.signed ?? { data: { signedUrl: "https://example.test/f" }, error: null }),
    remove: vi.fn(async () => answers.remove ?? { data: [], error: null }),
  };
  const from = vi.fn(() => bucket);
  return { client: { storage: { from } } as unknown as SupabaseClient, bucket, from };
}

describe("the server's storage helpers", () => {
  it("sign an upload and say null when storage refuses", async () => {
    const ok = fakeStorage();
    expect(await signQuizFileUpload(ok.client, "p")).toEqual({ token: "tok" });
    expect(ok.from).toHaveBeenCalledWith("quiz-answer-files");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await signQuizFileUpload(fakeStorage({ upload: { data: null, error: { message: "no" } } }).client, "p")).toBeNull();
    spy.mockRestore();
  });

  it("read the size storage holds, and null for a file that isn't there", async () => {
    const here = fakeStorage({ list: { data: [{ name: "a.pdf", metadata: { size: 321 } }], error: null } });
    expect(await quizFileSize(here.client, `${ADA}/${RANDOM}/a.pdf`)).toEqual({ bytes: 321 });
    expect(here.bucket.list).toHaveBeenCalledWith(`${ADA}/${RANDOM}`, { limit: 20 });
    expect(await quizFileSize(here.client, `${ADA}/${RANDOM}/b.pdf`)).toBeNull();
    expect(await quizFileSize(fakeStorage({ list: { data: [{ name: "a.pdf", metadata: null }], error: null } }).client, `${ADA}/${RANDOM}/a.pdf`)).toBeNull();
    await expect(quizFileSize(fakeStorage({ list: { data: null, error: { message: "down" } } }).client, `${ADA}/${RANDOM}/a.pdf`)).rejects.toThrow("down");
  });

  it("make a short download link that saves the file under its name", async () => {
    const s = fakeStorage();
    expect(await signedQuizFileDownload(s.client, "p", "letter.pdf")).toBe("https://example.test/f");
    expect(s.bucket.createSignedUrl).toHaveBeenCalledWith("p", 60, { download: "letter.pdf" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await signedQuizFileDownload(fakeStorage({ signed: { data: null, error: { message: "no" } } }).client, "p", "x")).toBeNull();
    spy.mockRestore();
  });

  it("delete files, doing nothing for none and logging a failure", async () => {
    const s = fakeStorage();
    expect(await removeQuizFiles(s.client, [])).toBe(0);
    expect(s.bucket.remove).not.toHaveBeenCalled();
    expect(await removeQuizFiles(s.client, ["a", "b"])).toBe(2);
    expect(s.bucket.remove).toHaveBeenCalledWith(["a", "b"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await removeQuizFiles(fakeStorage({ remove: { data: null, error: { message: "no" } } }).client, ["a"]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

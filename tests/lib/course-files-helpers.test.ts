import { describe, it, expect } from "vitest";
import { MAX_COURSE_FILE_BYTES, UPLOADED_FILE_KEY, contentTypeFor, formatBytes, parseLessonFileUpload, presignedExpiry, safeFilename, storagePathFor } from "@/lib/courses/files";

describe("contentTypeFor", () => {
  it("keeps a specific type the source reports, without parameters", () => {
    expect(contentTypeFor("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(contentTypeFor("a.txt", "text/plain; charset=utf-8")).toBe("text/plain");
  });

  it("falls back to the extension when the source says nothing useful (S3 often says octet-stream)", () => {
    expect(contentTypeFor("180_Tracker_Sheet.pdf", "binary/octet-stream")).toBe("application/pdf");
    expect(contentTypeFor("Sheet.XLSX", "application/octet-stream")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(contentTypeFor("notes.txt", null)).toBe("text/plain");
  });

  it("is octet-stream for an unknown extension", () => {
    expect(contentTypeFor("mystery.xyz", null)).toBe("application/octet-stream");
    expect(contentTypeFor("noextension", undefined)).toBe("application/octet-stream");
  });
});

describe("safeFilename and storagePathFor", () => {
  it("keeps letters, digits, dot, dash and underscore, and makes the rest underscores", () => {
    expect(safeFilename("180 Program: Week 1 (Tracker) Sheet.pdf")).toBe("180_Program_Week_1_Tracker_Sheet.pdf");
    expect(safeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(safeFilename("///")).toBe("file");
  });

  it("builds a path under the course and lesson, led by the Kajabi file id so two files with one name don't collide", () => {
    expect(storagePathFor("course-1", "lesson-1", "k99", "Tracker Sheet.pdf")).toBe("course-1/lesson-1/k99-Tracker_Sheet.pdf");
  });
});

describe("formatBytes", () => {
  it("reads sizes the way people do", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(151_552)).toBe("148 KB");
    expect(formatBytes(2_516_582)).toBe("2.4 MB");
  });

  it("is null for no size or nonsense", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
    expect(formatBytes(Number.NaN)).toBeNull();
  });
});

describe("presignedExpiry", () => {
  it("is the signing time plus the validity of an S3 presigned URL", () => {
    const url = "https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Date=20261014T120000Z&X-Amz-Expires=604800&X-Amz-Signature=abc";
    expect(presignedExpiry(url)).toBe(Date.UTC(2026, 9, 21, 12, 0, 0));
  });

  it("is null for anything that isn't a presigned link", () => {
    expect(presignedExpiry("https://example.test/f.pdf")).toBeNull();
    expect(presignedExpiry("not a url")).toBeNull();
    expect(presignedExpiry(null)).toBeNull();
  });
});

describe("parseLessonFileUpload", () => {
  it("accepts a named file of a size the bucket takes, keeping only the name when given a path", () => {
    expect(parseLessonFileUpload({ filename: "  Tracker Sheet.pdf ", size: 2048 })).toEqual({ ok: true, filename: "Tracker Sheet.pdf", size: 2048 });
    expect(parseLessonFileUpload({ filename: "C:\\Users\\a\\notes.txt", size: 1 })).toEqual({ ok: true, filename: "notes.txt", size: 1 });
    expect(parseLessonFileUpload({ filename: "a/b/notes.txt", size: MAX_COURSE_FILE_BYTES })).toEqual({ ok: true, filename: "notes.txt", size: MAX_COURSE_FILE_BYTES });
  });

  it("refuses no name, a name that is too long, an empty file, a file too large, and values that aren't a name or a size", () => {
    expect(parseLessonFileUpload({ filename: "  ", size: 10 })).toMatchObject({ ok: false, error: "That file has no name." });
    expect(parseLessonFileUpload({ filename: 5, size: 10 })).toMatchObject({ ok: false });
    expect(parseLessonFileUpload({ filename: `${"a".repeat(201)}.pdf`, size: 10 })).toMatchObject({ ok: false, error: expect.stringMatching(/longer than 200/) });
    expect(parseLessonFileUpload({ filename: "a.pdf", size: 0 })).toMatchObject({ ok: false, error: "That file is empty." });
    expect(parseLessonFileUpload({ filename: "a.pdf", size: Number.NaN })).toMatchObject({ ok: false });
    expect(parseLessonFileUpload({ filename: "a.pdf", size: "10" })).toMatchObject({ ok: false });
    expect(parseLessonFileUpload({ filename: "a.pdf", size: MAX_COURSE_FILE_BYTES + 1 })).toMatchObject({ ok: false, error: "That file is larger than 50 MB." });
  });
});

describe("UPLOADED_FILE_KEY", () => {
  it("matches the key an upload is given and nothing that could change the stored path", () => {
    expect(UPLOADED_FILE_KEY.test("up-123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(UPLOADED_FILE_KEY.test("up-../../x")).toBe(false);
    expect(UPLOADED_FILE_KEY.test("123e4567-e89b-12d3-a456-426614174000")).toBe(false);
    expect(UPLOADED_FILE_KEY.test("up-123e4567-e89b-12d3-a456-426614174000/extra")).toBe(false);
  });
});

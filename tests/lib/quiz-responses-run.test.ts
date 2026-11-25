/** The responses capture run without a browser: what it saves, what it counts, and that it prints no one's name, email, answer or file name. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryKajabiCourseRepository } from "@/lib/data/kajabi-courses";
import type { FileCopyIO } from "@/lib/kajabi/quiz-responses";
import { removalHash } from "@/lib/data/removal-hash";
import type { QuizRead } from "@/lib/kajabi/quiz-responses-run";

const NOW = new Date("2027-02-03T15:00:00.000Z");
const submission = (id: number, email: string, over: Record<string, unknown> = {}) => ({
  id,
  email,
  submitted_at: "2026-03-04T15:30:00.000Z",
  answers: [
    { question_id: 11, question_text: "What stood out?", answer_text: `Private words ${id}` },
    { question_id: 13, question_text: "Upload", file: { url: `https://files.example.test/${id}.pdf`, name: `secret-name-${id}.pdf`, size: 10 } },
  ],
  ...over,
});

let data: InMemoryDataset;
let mod: typeof import("@/lib/kajabi/quiz-responses-run");
beforeEach(async () => {
  data = new InMemoryDataset();
  const twin = new InMemoryKajabiCourseRepository(data);
  vi.resetModules();
  vi.doMock("@/lib/data/kajabi-courses", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/kajabi-courses")>()), SupabaseKajabiCourseRepository: class { constructor() { return twin; } } }));
  mod = await import("@/lib/kajabi/quiz-responses-run");
});

const fileIO = (): FileCopyIO => ({
  download: vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array(10), contentType: "application/pdf" })),
  upload: vi.fn(async () => true),
});
const quiz = { quizKajabiId: "489121", courseKajabiId: "course-1" };
const run = (reads: Record<string, QuizRead | Error>, apply = true, io = fileIO(), quizzes = [quiz]) => {
  const lines: string[] = [];
  const done = mod.runResponsesCapture({
    db: {} as never,
    quizzes,
    readQuiz: async (q) => {
      const read = reads[q.quizKajabiId];
      if (read instanceof Error) throw read;
      return read;
    },
    fileIO: io,
    apply,
    log: (line) => lines.push(line),
    now: NOW,
  });
  return { done, lines };
};
const read = (subs: unknown[], extra: Partial<QuizRead> = {}): QuizRead => ({ listed: subs.length, submissions: subs.map((s) => ({ key: null, documents: [s] })), failed: 0, incomplete: false, ...extra });

describe("runResponsesCapture", () => {
  it("saves each submission with its answers and the copy of its file, and prints counts only", async () => {
    const io = fileIO();
    const { done, lines } = run({ "489121": read([submission(1, "ada@example.test"), submission(2, "bo@example.test")]) }, true, io);
    const summary = await done;

    expect(summary).toMatchObject({ quizzes: 1, read: 2, responders: 2, unreadable: 0, rows: { created: 2, updated: 0, unchanged: 0 }, answers: 4, files: { copied: 2 } });
    expect(data.kajabiQuizResponses.map((r) => [r.submission_key, r.email])).toEqual([["1", "ada@example.test"], ["2", "bo@example.test"]]);
    expect(JSON.stringify(data.kajabiQuizResponses[0].answers)).toContain("kajabi-import/489121/1/secret-name-1.pdf");
    expect(io.upload).toHaveBeenCalledTimes(2);
    const printed = [...lines, mod.formatResponsesTotals(true, summary)].join("\n");
    for (const secret of ["ada@example.test", "bo@example.test", "Private words", "secret-name"]) expect(printed).not.toContain(secret);
  });

  it("writes and copies nothing in a dry run, and counts a second capture as unchanged, without downloading the files again", async () => {
    const io = fileIO();
    const dry = await run({ "489121": read([submission(1, "ada@example.test")]) }, false, io).done;
    expect(dry.rows.created).toBe(1);
    expect(data.kajabiQuizResponses).toHaveLength(0);
    expect(io.upload).not.toHaveBeenCalled();

    await run({ "489121": read([submission(1, "ada@example.test")]) }, true, io).done;
    const again = await run({ "489121": read([submission(1, "ada@example.test")]) }, true, io).done;
    expect(again.rows).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(again.files.alreadyCopied).toBe(1);
    expect(io.upload).toHaveBeenCalledTimes(1);
  });

  it("never removes what Bronze holds, even when the Results tab no longer lists it", async () => {
    await run({ "489121": read([submission(1, "ada@example.test"), submission(2, "bo@example.test")]) }).done;
    await run({ "489121": read([submission(2, "bo@example.test")]) }).done;
    expect(data.kajabiQuizResponses.map((r) => [r.submission_key, r.deleted_at])).toEqual([["1", null], ["2", null]]);
  });

  it("describes an unreadable submission by field names and types only, once, and counts it", async () => {
    const { done, lines } = run({ "489121": read([{ nothing: "private text", deeper: { n: 1 } }, { more: "other private text" }]) });
    const summary = await done;
    expect(summary).toMatchObject({ read: 0, unreadable: 2 });
    const shown = lines.filter((l) => l.includes("unreadable submission"));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.join("\n")).toContain("nothing: string");
    expect(lines.join("\n")).not.toContain("private text");
    expect(shown.some((l) => l.includes("more:"))).toBe(false);
  });

  it("counts a quiz that couldn't be read and carries on, but stops for an expired login", async () => {
    const other = { quizKajabiId: "2", courseKajabiId: "course-1" };
    const summary = await run({ "489121": new Error("the page changed"), "2": read([submission(7, "cy@example.test")]) }, true, fileIO(), [quiz, other]).done;
    expect(summary).toMatchObject({ quizzes: 2, quizzesFailed: 1, read: 1 });
    await expect(run({ "489121": new mod.ResponsesSessionExpiredError("expired") }).done).rejects.toBeInstanceOf(mod.ResponsesSessionExpiredError);
  });

  it("keeps one row for a submission opened twice, and reports submissions that could not be opened", async () => {
    const twice = read([submission(1, "ada@example.test"), submission(1, "ada@example.test")], { failed: 2, incomplete: true });
    const { done, lines } = run({ "489121": twice });
    const summary = await done;
    expect(summary).toMatchObject({ read: 1, openFailed: 2, rows: { created: 1 } });
    expect(lines.join("\n")).toContain("the Results tab was not read to the end");
  });

  it("stores and copies nothing for a responder who was removed on request, whatever case the address is in, and says how many were skipped", async () => {
    data.removalTombstones.push({ kind: "email", key_hash: removalHash("ada@example.test"), created_at: "2027-01-01T00:00:00.000Z" });
    // A fingerprint of another kind never blocks an address.
    data.removalTombstones.push({ kind: "kajabi_comment", key_hash: removalHash("bo@example.test"), created_at: "2027-01-01T00:00:00.000Z" });
    const io = fileIO();
    const { done, lines } = run({ "489121": read([submission(1, "Ada@Example.test"), submission(2, "bo@example.test"), submission(3, "ada@example.test")]) }, true, io);
    const summary = await done;

    expect(summary).toMatchObject({ read: 1, responders: 1, removedResponders: 2, rows: { created: 1 }, files: { copied: 1 } });
    expect(data.kajabiQuizResponses.map((r) => r.email)).toEqual(["bo@example.test"]);
    expect(io.download).toHaveBeenCalledTimes(1);
    expect(io.upload).toHaveBeenCalledTimes(1);
    const printed = [...lines, mod.formatResponsesTotals(true, summary)].join("\n");
    expect(printed).toContain("2 skipped");
    expect(printed.toLowerCase()).not.toContain("ada@example.test");
  });

  it("counts none skipped when nobody was removed", async () => {
    const summary = await run({ "489121": read([submission(1, "ada@example.test")]) }, false).done;
    expect(summary.removedResponders).toBe(0);
  });

  it("prints the distinct type names it saw (Kajabi's own enum values), and reads a position-keyed submission", async () => {
    const real = { data: { id: "7", type: "quiz_results", attributes: { contactEmail: "ada@example.test", dateSubmittedAt: "2026-05-10T22:38:00.000Z" } }, included: [{ id: "a", type: "quiz_result_answers", attributes: { answer: "words", questionTitle: "Why?", questionType: "short_answer", questionPosition: 1, fileUrl: null } }] };
    const { done, lines } = run({ "489121": read([real]) });
    const summary = await done;
    expect(summary).toMatchObject({ read: 1, seen: { types: ["quiz_result_answers", "quiz_results"], questionTypes: ["short_answer"] } });
    expect(lines).toContain("resource types seen: quiz_result_answers, quiz_results; question types seen: short_answer");
    expect(data.kajabiQuizResponses[0]).toMatchObject({ submission_key: "7", email: "ada@example.test", submitted_at: "2026-05-10T22:38:00.000Z" });
    expect(JSON.stringify(data.kajabiQuizResponses[0].answers)).toContain("pos:1");
  });

  it("lists the files that could not be copied by reason", async () => {
    const io = fileIO();
    io.download = vi.fn(async () => ({ ok: false as const, failure: "expired" as const }));
    const summary = await run({ "489121": read([submission(1, "ada@example.test")]) }, true, io).done;
    expect(summary.files.failed).toEqual({ expired: 1 });
    expect(mod.formatResponsesTotals(true, summary)).toContain("could not copy: 1 expired");
    expect(mod.formatResponsesTotals(false, summary)).toContain("Dry run, nothing written");
  });
});

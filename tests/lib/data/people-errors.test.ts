import { describe, expect, it } from "vitest";
import { SupabaseAdminWorkQueueRepository } from "@/lib/data/admin-work";
import { SupabaseAwardRepository } from "@/lib/data/awards";
import { SupabaseMemberProfileRepository } from "@/lib/data/member-profile";
import { SupabaseMemberRepository } from "@/lib/data/members";
import { SupabaseMentorshipRepository } from "@/lib/data/mentorship";
import { SupabaseOutreachRepository } from "@/lib/data/outreach";
import { SupabaseStaffRepository } from "@/lib/data/staff";
import { failingDb } from "@/tests/helpers/people-fixtures";

const db = failingDb();
const id = "mbr_AAAAAAAAAAA1";
const other = "mbr_AAAAAAAAAAA2";

describe("people repositories database errors", () => {
  const staff = new SupabaseStaffRepository(db);
  const mentorship = new SupabaseMentorshipRepository(db);
  const profile = new SupabaseMemberProfileRepository(db);
  const awards = new SupabaseAwardRepository(db);
  const outreach = new SupabaseOutreachRepository(db);
  const adminWork = new SupabaseAdminWorkQueueRepository(db);
  const members = new SupabaseMemberRepository(db);

  it.each([
    ["staff.all", () => staff.all()],
    ["staff.linkMembers", () => staff.linkMembers([{ id, member_id: other }])],
    ["mentorship.listWithMembers", () => mentorship.listWithMembers()],
    ["mentorship.matchedArrivals", () => mentorship.matchedArrivals()],
    ["mentorship.create", () => mentorship.create({ mentor_member_id: id, new_member_id: other, started_on: "2026-01-01", kind: "direct" })],
    ["mentorship.update", () => mentorship.update(id, { status: "reassigned" })],
    ["mentorship.delete", () => mentorship.delete(id)],
    ["mentorship.volunteers", () => mentorship.volunteers()],
    ["mentorship.volunteerNote", () => mentorship.volunteerNote(id)],
    ["mentorship.volunteer", () => mentorship.volunteer(id, null)],
    ["mentorship.withdraw", () => mentorship.withdraw(id)],
    ["mentorship.counts", () => mentorship.counts()],
    ["mentorship.myMentorships", () => mentorship.myMentorships(id)],
    ["mentorship.setNote", () => mentorship.setNote(id, "x")],
    ["memberProfile.askMeAbout", () => profile.askMeAbout(id)],
    ["memberProfile.saveAskMeAbout", () => profile.saveAskMeAbout(id, ["x"], "user")],
    ["memberProfile.noteAbout", () => profile.noteAbout(id, other)],
    ["memberProfile.notesBy", () => profile.notesBy(id)],
    ["memberProfile.saveNote", () => profile.saveNote(id, other, "x")],
    ["memberProfile.deleteNote", () => profile.deleteNote(id, other)],
    ["memberProfile.rosterOptOuts", () => profile.rosterOptOuts([id])],
    ["memberProfile.setRosterVisible(show)", () => profile.setRosterVisible(id, true)],
    ["memberProfile.setRosterVisible(hide)", () => profile.setRosterVisible(id, false)],
    ["memberProfile.onboardingOf", () => profile.onboardingOf(id)],
    ["memberProfile.saveOnboarding", () => profile.saveOnboarding(id, { marked_steps: [] })],
    ["memberProfile.slackConnectionOf", () => profile.slackConnectionOf(id)],
    ["memberProfile.slackUserConnectedByOther", () => profile.slackUserConnectedByOther("U1", id)],
    ["memberProfile.slackUserLinks", () => profile.slackUserLinks()],
    ["awards.ofMember", () => awards.ofMember(id)],
    ["awards.add", () => awards.add({ member_id: id, award_name: "a", work_title: "w", award_date: "2026-01-01" })],
    ["awards.update", () => awards.update(id, { award_name: "a", work_title: "w", award_date: "2026-01-01" })],
    ["awards.remove", () => awards.remove(id)],
    ["awards.search", () => awards.search({ words: ["a"], memberIds: [id], after: "2026-01-01", before: "2026-12-01", limit: 5, offset: 0 })],
    ["outreach.leadStatuses", () => outreach.leadStatuses()],
    ["outreach.setLeadStatus", () => outreach.setLeadStatus(id, "hot", null)],
    ["outreach.logTouch", () => outreach.logTouch(id, null)],
    ["outreach.lastTouchByMember", () => outreach.lastTouchByMember([id])],
    ["outreach.touchTimesSince", () => outreach.touchTimesSince("2026-01-01T00:00:00Z")],
    ["adminWork.completions", () => adminWork.completions()],
    ["adminWork.complete", () => adminWork.complete({ queue_type: "welcome_back", member_id: id, occurrence_key: "k", status: "completed" })],
    ["adminWork.undoCompletion", () => adminWork.undoCompletion(id)],
    ["adminWork.dismissedGroupKeys", () => adminWork.dismissedGroupKeys()],
    ["adminWork.dismissGroup", () => adminWork.dismissGroup("k")],
    ["adminWork.restoreGroup", () => adminWork.restoreGroup("k")],
    ["adminWork.feedbackPage", () => adminWork.feedbackPage({ status: "new", page: 0, pageSize: 10 })],
    ["adminWork.addFeedback", () => adminWork.addFeedback({ user_id: "u", page_url: "/", feedback_type: "bug", message: "m" })],
    ["adminWork.updateFeedback", () => adminWork.updateFeedback(id, { status: "resolved" })],
    ["members.withKajabiTag", () => members.withKajabiTag("t", ["lead"])],
    ["members.tenureOf", () => members.tenureOf(["active"])],
  ])("%s throws the database's error", async (_name, run) => {
    await expect(run()).rejects.toThrow("database is down");
  });

  it("answers a search for no members without asking the database", async () => {
    expect(await awards.search({ words: [], memberIds: [], limit: 5, offset: 0 })).toEqual([]);
  });
});

/** A client whose queries answer with a given error code, for the cases a caller tells apart. */
function codeDb(code: string) {
  const answer = { data: null, error: { message: "boom", code } };
  const chain: Record<string, unknown> = {};
  for (const m of ["insert", "update", "eq", "upsert", "select"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(answer);
  return { from: () => chain } as never;
}

describe("a unique violation", () => {
  it("is a refused match, not an error", async () => {
    const repo = new SupabaseMentorshipRepository(codeDb("23505"));
    expect(await repo.create({ mentor_member_id: "a", new_member_id: "b", started_on: "2026-01-01", kind: "direct" })).toEqual({ ok: false, reason: "already_matched" });
    expect(await repo.update("x", { status: "matched" })).toEqual({ ok: false, reason: "already_matched" });
  });

  it("is ignored when a duplicate group is dismissed twice", async () => {
    await expect(new SupabaseAdminWorkQueueRepository(codeDb("23505")).dismissGroup("k")).resolves.toBeUndefined();
    await expect(new SupabaseAdminWorkQueueRepository(codeDb("42501")).dismissGroup("k")).rejects.toThrow("boom");
  });
});

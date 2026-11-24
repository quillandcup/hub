// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ThreadComment, ThreadEntry } from "@/lib/data/course-comments";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));
const postLessonComment = vi.fn();
const editLessonComment = vi.fn();
const deleteLessonComment = vi.fn();
const reportLessonComment = vi.fn();
const setLessonCommentFollow = vi.fn();
const suggestCommentMentions = vi.fn();
vi.mock("@/app/(member)/courses/comment-actions", () => ({
  postLessonComment: (...a: unknown[]) => postLessonComment(...a),
  editLessonComment: (...a: unknown[]) => editLessonComment(...a),
  deleteLessonComment: (...a: unknown[]) => deleteLessonComment(...a),
  reportLessonComment: (...a: unknown[]) => reportLessonComment(...a),
  setLessonCommentFollow: (...a: unknown[]) => setLessonCommentFollow(...a),
  suggestCommentMentions: (...a: unknown[]) => suggestCommentMentions(...a),
}));

import CommentThread from "@/components/courses/CommentThread";
import { PlayerTimeProvider, useSeekRequest } from "@/components/courses/PlayerTime";

// The real player pulls in the video library; the thread only needs the page's shared clock.
vi.mock("@/components/courses/LessonPlayer", () => ({ default: () => null }));

const NOW = Date.parse("2027-03-01T15:00:00Z");
const comment = (over: Partial<ThreadComment> & { id: string }): ThreadComment => ({
  lessonId: "les_AAAAAAAAAAA1",
  memberId: "m2",
  parentId: null,
  authorName: "Bea Example",
  isStaffReply: false,
  createdAt: new Date(NOW - 3600_000).toISOString(),
  editedAt: null,
  removed: false,
  body: "A question",
  hidden: false,
  held: false,
  ...over,
});

function renderThread(entries: ThreadEntry[], over: Partial<React.ComponentProps<typeof CommentThread>> = {}) {
  return render(
    <CommentThread
      lessonId="les_AAAAAAAAAAA1"
      courseId="crs_AAAAAAAAAAA1"
      entries={entries}
      count={entries.reduce((n, e) => n + (e.comment.removed ? 0 : 1) + e.replies.length, 0)}
      following={false}
      unread={0}
      currentMemberId="m1"
      isStaff={false}
      readOnly={false}
      timeZone="America/New_York"
      nowMs={NOW}
      {...over}
    />,
  );
}

beforeEach(() => {
  cleanup();
  refresh.mockReset();
  track.mockReset();
  postLessonComment.mockReset().mockResolvedValue({ id: "cmnt_AAAAAAAAAAA9" });
  editLessonComment.mockReset().mockResolvedValue({ id: "x" });
  deleteLessonComment.mockReset().mockResolvedValue({ id: "x" });
  reportLessonComment.mockReset().mockResolvedValue({ id: "x" });
  setLessonCommentFollow.mockReset().mockResolvedValue({ id: "les_AAAAAAAAAAA1" });
  suggestCommentMentions.mockReset().mockResolvedValue([]);
  window.history.replaceState(null, "", "/");
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("CommentThread", () => {
  it("says what to do when there are no questions, and tells who can see comments", () => {
    renderThread([]);
    expect(screen.getByRole("region", { name: "Comments (0)" })).toBeInTheDocument();
    expect(screen.getByText("No questions yet. Stuck on something in this lesson? Ask here.")).toBeInTheDocument();
    expect(screen.getByText(/visible to members of this course and our staff/)).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("lesson_comments_viewed", { course_id: "crs_AAAAAAAAAAA1", count_bucket: "0" });
  });

  it("posts a comment, announces it, refreshes and records it without the text", async () => {
    renderThread([]);
    const box = screen.getByLabelText("Ask a question or leave a comment");
    await userEvent.type(box, "How do I start?");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(postLessonComment).toHaveBeenCalledWith("les_AAAAAAAAAAA1", "How do I start?", null);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("Comment posted");
    expect(track).toHaveBeenCalledWith("lesson_comment_posted", { course_id: "crs_AAAAAAAAAAA1", is_reply: false, is_staff: false, has_mention: false });
    expect(JSON.stringify(track.mock.calls)).not.toContain("How do I start");
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });

  it("keeps the text and shows the error when posting is refused", async () => {
    postLessonComment.mockResolvedValue({ error: "You're posting quickly. Try again in a little while." });
    renderThread([]);
    await userEvent.type(screen.getByLabelText("Ask a question or leave a comment"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText(/posting quickly/)).toBeInTheDocument();
    expect(screen.getByLabelText("Ask a question or leave a comment")).toHaveValue("Hello");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps Post disabled for an empty box and over 4,000 characters", async () => {
    renderThread([]);
    const post = screen.getByRole("button", { name: "Post comment" });
    expect(post).toBeDisabled();
    const box = screen.getByLabelText("Ask a question or leave a comment");
    await userEvent.click(box);
    await userEvent.paste("x".repeat(4001));
    expect(post).toBeDisabled();
    expect(screen.getByText(/4,001 of 4,000 characters/)).toBeInTheDocument();
  });

  it("replies with the keyboard, under the question, and announces it", async () => {
    renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA1" }), replies: [] }]);
    // Reach the Reply button with the keyboard alone: Follow, the composer's textarea (Post is disabled while empty), then Reply.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Reply" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const box = screen.getByLabelText("Your reply");
    expect(box).toHaveFocus();
    await userEvent.type(box, "Try the hook first");
    const form = box.closest("form")!;
    await userEvent.click(within(form).getByRole("button", { name: "Reply" }));

    expect(postLessonComment).toHaveBeenCalledWith("les_AAAAAAAAAAA1", "Try the hook first", "cmnt_AAAAAAAAAAA1");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Reply posted"));
    expect(track).toHaveBeenCalledWith("lesson_comment_posted", { course_id: "crs_AAAAAAAAAAA1", is_reply: true, is_staff: false, has_mention: false });
  });

  it("shows replies oldest first, an Instructor badge, edited, and a tombstone that keeps its replies", () => {
    renderThread([
      {
        comment: comment({ id: "cmnt_AAAAAAAAAAA1", removed: true, body: null, authorName: "" }),
        replies: [
          comment({ id: "cmnt_AAAAAAAAAAA2", parentId: "cmnt_AAAAAAAAAAA1", authorName: "Sam Staff", isStaffReply: true, body: "Answer", editedAt: new Date(NOW).toISOString() }),
        ],
      },
    ]);
    expect(screen.getByText("Comment removed")).toBeInTheDocument();
    expect(screen.getByText("Instructor")).toBeInTheDocument();
    expect(screen.getByText("edited")).toBeInTheDocument();
    expect(screen.getByText("1 hour ago")).toBeInTheDocument();
  });

  it("renders text as text with only http(s) addresses linked, and a name with & and < as typed", () => {
    renderThread([
      { comment: comment({ id: "cmnt_AAAAAAAAAAA1", authorName: "Ada <Quill> & Co", body: "See https://example.com/a. <script>alert(1)</script> javascript:alert(1)" }), replies: [] },
    ]);
    expect(screen.getByText("Ada <Quill> & Co")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://example.com/a" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("rel", expect.stringContaining("nofollow"));
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script> javascript:alert\(1\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("offers edit only on your own recent comment, and saves it", async () => {
    renderThread([
      { comment: comment({ id: "cmnt_AAAAAAAAAAA1", memberId: "m1", authorName: "Me", body: "Mine", createdAt: new Date(NOW - 5 * 60_000).toISOString() }), replies: [] },
      { comment: comment({ id: "cmnt_AAAAAAAAAAA2", memberId: "m1", authorName: "Me", body: "Old mine", createdAt: new Date(NOW - 20 * 60_000).toISOString() }), replies: [] },
      { comment: comment({ id: "cmnt_AAAAAAAAAAA3", memberId: "m2", body: "Theirs" }), replies: [] },
    ]);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit your comment");
    await userEvent.clear(box);
    await userEvent.type(box, "Mine, better");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(editLessonComment).toHaveBeenCalledWith("cmnt_AAAAAAAAAAA1", "Mine, better");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(track).toHaveBeenCalledWith("lesson_comment_edited", { course_id: "crs_AAAAAAAAAAA1" });
  });

  it("asks before deleting, and deletes once confirmed", async () => {
    renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA1", memberId: "m1", authorName: "Me" }), replies: [] }]);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteLessonComment).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(deleteLessonComment).toHaveBeenCalledWith("cmnt_AAAAAAAAAAA1");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(track).toHaveBeenCalledWith("lesson_comment_deleted", { course_id: "crs_AAAAAAAAAAA1", is_reply: false });
  });

  it("is read-only while previewing: the composer and Reply are disabled, and no edit or delete shows", () => {
    renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA1", memberId: "m1", authorName: "Me" }), replies: [] }], { readOnly: true });
    expect(screen.getByLabelText("Ask a question or leave a comment")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Post comment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText(/Read-only while previewing/)).toBeInTheDocument();
  });

  it("marks what staff post as from an instructor in its event", async () => {
    renderThread([], { isStaff: true });
    await userEvent.type(screen.getByLabelText("Ask a question or leave a comment"), "Welcome!");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(track).toHaveBeenCalledWith("lesson_comment_posted", expect.objectContaining({ is_staff: true })));
    expect(within(screen.getByRole("region")).getByRole("status")).toBeInTheDocument();
  });

  describe("reporting and review", () => {
    const others = () => renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA2", body: "Someone else's words" }), replies: [] }]);

    it("offers Report on someone else's comment only, and sends a reason with the keyboard", async () => {
      others();
      await userEvent.click(screen.getByRole("button", { name: "Report" }));
      const box = screen.getByLabelText("What's wrong with this comment?");
      expect(box).toHaveFocus();
      expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
      await userEvent.type(box, "Spam & <links>");
      await userEvent.keyboard("{Tab}");
      expect(screen.getByRole("button", { name: "Send report" })).toHaveFocus();
      await userEvent.keyboard("{Enter}");

      await waitFor(() => expect(reportLessonComment).toHaveBeenCalledWith("cmnt_AAAAAAAAAAA2", "Spam & <links>"));
      // The event carries the course and whether it was a reply, never the reason.
      expect(track).toHaveBeenCalledWith("lesson_comment_reported", { course_id: "crs_AAAAAAAAAAA1", is_reply: false });
      expect(JSON.stringify(track.mock.calls)).not.toContain("Spam");
      expect(await screen.findByText("Reported")).toBeInTheDocument();
      expect(screen.queryByLabelText("What's wrong with this comment?")).toBeNull();
      expect(refresh).toHaveBeenCalled();
    });

    it("says the author isn't told, can be cancelled, and keeps the form with the error when refused", async () => {
      reportLessonComment.mockResolvedValue({ error: "You've already reported this comment" });
      others();
      await userEvent.click(screen.getByRole("button", { name: "Report" }));
      expect(screen.getByText(/isn't told/)).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("What's wrong with this comment?"), "Rude");
      await userEvent.click(screen.getByRole("button", { name: "Send report" }));
      expect(await screen.findByText("You've already reported this comment")).toBeInTheDocument();
      expect(track).not.toHaveBeenCalledWith("lesson_comment_reported", expect.anything());
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByLabelText("What's wrong with this comment?")).toBeNull();
    });

    it("hides Report on your own comment, while previewing, and for staff", () => {
      renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA1", memberId: "m1", authorName: "Me" }), replies: [] }]);
      expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
      cleanup();
      renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA2" }), replies: [] }], { readOnly: true });
      expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
      cleanup();
      renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA2" }), replies: [] }], { isStaff: true });
      expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    });

    it("shows a held comment to its author with a note, no Reply and a held badge", () => {
      renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA1", memberId: "m1", authorName: "Me", held: true, body: "links links links" }), replies: [] }]);
      expect(screen.getByText("Held for review")).toBeInTheDocument();
      expect(screen.getByText(/Only you and our staff can see this/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });

    it("shows staff a hidden comment with its text and a badge, and a member the tombstone", () => {
      renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA2", hidden: true, body: "Hidden words" }), replies: [] }], { isStaff: true });
      expect(screen.getByText("Hidden from members")).toBeInTheDocument();
      expect(screen.getByText("Hidden words")).toBeInTheDocument();
      cleanup();
      renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA2", removed: true, body: null, authorName: "" }), replies: [{ ...comment({ id: "cmnt_AAAAAAAAAAA3", parentId: "cmnt_AAAAAAAAAAA2" }) }] }]);
      expect(screen.getByText("Comment removed")).toBeInTheDocument();
      // Only the reply carries a Report button; the tombstone has none.
      expect(screen.getAllByRole("button", { name: "Report" })).toHaveLength(1);
    });

    it("tells the writer a held post will show once staff have looked", async () => {
      postLessonComment.mockResolvedValue({ id: "cmnt_AAAAAAAAAAA9", held: true });
      renderThread([]);
      await userEvent.type(screen.getByLabelText("Ask a question or leave a comment"), "see a b c");
      await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
      expect(await screen.findByText(/will show to others once staff have looked/)).toBeInTheDocument();
    });
  });
  it("follows and unfollows the lesson's comments, saying what that means, and records the choice without who", async () => {
    const user = userEvent.setup();
    renderThread([]);
    const button = screen.getByRole("button", { name: "Follow" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Follow to hear about instructors' replies/)).toBeInTheDocument();
    await user.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Following" })).toHaveAttribute("aria-pressed", "true"));
    expect(setLessonCommentFollow).toHaveBeenCalledWith("les_AAAAAAAAAAA1", true);
    expect(track).toHaveBeenCalledWith("lesson_follow_toggled", { course_id: "crs_AAAAAAAAAAA1", following: true });
    expect(screen.getByText("You follow this lesson's comments")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Following" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument());
    expect(setLessonCommentFollow).toHaveBeenLastCalledWith("les_AAAAAAAAAAA1", false);
  });

  it("keeps the old state and shows the error when following is refused", async () => {
    setLessonCommentFollow.mockResolvedValue({ error: "Couldn't save that" });
    const user = userEvent.setup();
    renderThread([]);
    await user.click(screen.getByRole("button", { name: "Follow" }));
    expect(await screen.findByText("Couldn't save that")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
  });

  it("has no follow button while previewing as a member", () => {
    renderThread([], { readOnly: true });
    expect(screen.queryByRole("button", { name: /^Follow/ })).toBeNull();
  });

  it("says how many comments are new since the last visit", () => {
    renderThread([], { unread: 3, following: true });
    expect(screen.getByText("3 new since your last visit")).toBeInTheDocument();
    expect(screen.getByText(/You'll hear about instructors' replies here/)).toBeInTheDocument();
  });

  it("scrolls to and marks the comment a notification linked to", () => {
    window.history.replaceState(null, "", "/courses/c/lessons/l?comment=cmnt_AAAAAAAAAAA2");
    const entry = { comment: comment({ id: "cmnt_AAAAAAAAAAA1" }), replies: [comment({ id: "cmnt_AAAAAAAAAAA2", parentId: "cmnt_AAAAAAAAAAA1", body: "The reply" })] };
    renderThread([entry]);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.getElementById("cmnt_AAAAAAAAAAA2")?.className).toContain("ring-2");
    expect(document.getElementById("cmnt_AAAAAAAAAAA1")?.className ?? "").not.toContain("ring-2");
  });

  describe("video timestamps", () => {
    function Probe() {
      const request = useSeekRequest();
      return <span data-testid="seek">{request ? `${request.seconds}#${request.nonce}` : "none"}</span>;
    }
    const withTimes = comment({ id: "cmnt_AAAAAAAAAAA1", body: "Lost at 2:35 and 1:02:03, not at 2:75 or 10:30pm" });

    it("makes a typed timestamp a button that moves the video, and says so", async () => {
      const user = userEvent.setup();
      render(
        <PlayerTimeProvider>
          <CommentThread lessonId="les_AAAAAAAAAAA1" courseId="crs_AAAAAAAAAAA1" entries={[{ comment: withTimes, replies: [] }]} count={1} following={false} unread={0} currentMemberId="m1" isStaff={false} readOnly={false} canSeek timeZone="America/New_York" nowMs={NOW} />
          <Probe />
        </PlayerTimeProvider>,
      );
      await user.click(screen.getByRole("button", { name: "Play the video from 2 minutes 35 seconds" }));
      expect(screen.getByTestId("seek")).toHaveTextContent("155#1");
      expect(screen.getByRole("status")).toHaveTextContent("Playing the video from 2 minutes 35 seconds");
      // The same second again is a new request, so the video moves back to it.
      await user.click(screen.getByRole("button", { name: "Play the video from 2 minutes 35 seconds" }));
      expect(screen.getByTestId("seek")).toHaveTextContent("155#2");
      await user.click(screen.getByRole("button", { name: "Play the video from 1 hour 2 minutes 3 seconds" }));
      expect(screen.getByTestId("seek")).toHaveTextContent("3723#3");
      // Not a time: left as text.
      expect(screen.getAllByRole("button", { name: /^Play the video/ })).toHaveLength(2);
    });

    it("leaves a timestamp as text when the lesson has no video to move", () => {
      renderThread([{ comment: withTimes, replies: [] }]);
      expect(screen.queryByRole("button", { name: /^Play the video/ })).toBeNull();
      expect(screen.getByText((_, el) => el?.tagName === "P" && Boolean(el.textContent?.startsWith("Lost at 2:35 and 1:02:03, not at 2:75 or 10:30pm")))).toBeInTheDocument();
    });

    it("works in a reply too", async () => {
      const user = userEvent.setup();
      const reply = comment({ id: "cmnt_AAAAAAAAAAA2", parentId: "cmnt_AAAAAAAAAAA1", body: "See 0:45" });
      render(
        <PlayerTimeProvider>
          <CommentThread lessonId="les_AAAAAAAAAAA1" courseId="crs_AAAAAAAAAAA1" entries={[{ comment: comment({ id: "cmnt_AAAAAAAAAAA1" }), replies: [reply] }]} count={2} following={false} unread={0} currentMemberId="m1" isStaff={false} readOnly={false} canSeek timeZone="America/New_York" nowMs={NOW} />
          <Probe />
        </PlayerTimeProvider>,
      );
      await user.click(screen.getByRole("button", { name: "Play the video from 45 seconds" }));
      expect(screen.getByTestId("seek")).toHaveTextContent("45#1");
    });
  });

  describe("instructor answers filter", () => {
    const asked = { comment: comment({ id: "cmnt_AAAAAAAAAAA1", body: "Unanswered question" }), replies: [] };
    const answered = {
      comment: comment({ id: "cmnt_AAAAAAAAAAA2", body: "Answered question" }),
      replies: [comment({ id: "cmnt_AAAAAAAAAAA3", parentId: "cmnt_AAAAAAAAAAA2", body: "Here is the answer", isStaffReply: true, authorName: "Sam Staff" })],
    };

    it("offers it only when an instructor has taken part, and keeps just those questions", async () => {
      const user = userEvent.setup();
      renderThread([asked, answered]);
      expect(screen.getByRole("button", { name: "All comments", pressed: true })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Instructor answers" }));
      expect(screen.getByRole("button", { name: "Instructor answers", pressed: true })).toBeInTheDocument();
      expect(screen.queryByText("Unanswered question")).toBeNull();
      expect(screen.getByText("Answered question")).toBeInTheDocument();
      expect(screen.getByText("Here is the answer")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "All comments" }));
      expect(screen.getByText("Unanswered question")).toBeInTheDocument();
    });

    it("has no filter when no instructor is in the thread", () => {
      renderThread([asked]);
      expect(screen.queryByRole("button", { name: "Instructor answers" })).toBeNull();
    });
  });

  describe("mentions", () => {
    const CAL = "mbr_AAAAAAAAAAA3";
    const SAM = "mbr_AAAAAAAAAAA4";
    const choices = [
      { memberId: CAL, name: "Cal <Quill> & Co", isInstructor: false },
      { memberId: SAM, name: "Sam Staff", isInstructor: true },
    ];

    it("offers the people of the course after an @, with instructors badged, and a click puts the name in the box", async () => {
      suggestCommentMentions.mockResolvedValue(choices);
      const user = userEvent.setup();
      renderThread([]);
      const box = screen.getByLabelText("Ask a question or leave a comment");
      await user.type(box, "Thanks @ca");

      const list = await screen.findByRole("listbox", { name: "People you can mention" });
      expect(suggestCommentMentions).toHaveBeenLastCalledWith("les_AAAAAAAAAAA1", "ca");
      expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Cal <Quill> & Co", "Sam StaffInstructor"]);
      await user.click(within(list).getAllByRole("option")[0]);

      expect(box).toHaveValue("Thanks @Cal <Quill> & Co ");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("picks with the keyboard and sends the member's token, not the name", async () => {
      suggestCommentMentions.mockResolvedValue(choices);
      const user = userEvent.setup();
      renderThread([]);
      const box = screen.getByLabelText("Ask a question or leave a comment");
      await user.type(box, "@sa");
      await screen.findByRole("listbox");
      expect(box).toHaveAttribute("aria-expanded", "true");

      await user.keyboard("{ArrowDown}{Enter}");
      expect(box).toHaveValue("@Sam Staff ");
      await user.type(box, "can you look?");
      await user.click(screen.getByRole("button", { name: "Post comment" }));

      expect(postLessonComment).toHaveBeenCalledWith("les_AAAAAAAAAAA1", `@[${SAM}] can you look?`, null);
      expect(track).toHaveBeenCalledWith("lesson_comment_posted", { course_id: "crs_AAAAAAAAAAA1", is_reply: false, is_staff: false, has_mention: true });
    });

    it("closes the list on Escape, and a name typed by hand mentions no one", async () => {
      suggestCommentMentions.mockResolvedValue(choices);
      const user = userEvent.setup();
      renderThread([]);
      const box = screen.getByLabelText("Ask a question or leave a comment");
      await user.type(box, "@Sam Staff");
      await screen.findByRole("listbox");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Post comment" }));
      expect(postLessonComment).toHaveBeenCalledWith("les_AAAAAAAAAAA1", "@Sam Staff", null);
      expect(track).toHaveBeenCalledWith("lesson_comment_posted", expect.objectContaining({ has_mention: false }));
    });

    it("does not look anyone up for an email address, a lone @, or while previewing", async () => {
      const user = userEvent.setup();
      renderThread([]);
      const box = screen.getByLabelText("Ask a question or leave a comment");
      await user.type(box, "write to ada@example.com or @ later");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(suggestCommentMentions).not.toHaveBeenCalled();
      cleanup();
      renderThread([], { readOnly: true });
      expect(screen.getByLabelText("Ask a question or leave a comment")).toBeDisabled();
    });

    it("shows a mention by the person's current name, as text, and 'someone' when it can't be named", () => {
      const body = `Hello @[${CAL}] and @[mbr_AAAAAAAAAAA9]`;
      renderThread([{ comment: comment({ id: "cmnt_AAAAAAAAAAA1", body }), replies: [] }], { mentionNames: { [CAL]: "Cal <Quill> & Co" } });
      expect(screen.getByText("@Cal <Quill> & Co")).toBeInTheDocument();
      expect(screen.getByText("@someone")).toBeInTheDocument();
      expect(screen.queryByText(/mbr_/)).toBeNull();
    });

    it("edits a comment with its mentions as names and saves them as tokens again", async () => {
      const user = userEvent.setup();
      const mine = comment({ id: "cmnt_AAAAAAAAAAA1", memberId: "m1", createdAt: new Date(NOW - 60_000).toISOString(), body: `Hi @[${CAL}], hello` });
      renderThread([{ comment: mine, replies: [] }], { mentionNames: { [CAL]: "Cal Example" } });
      await user.click(screen.getByRole("button", { name: "Edit" }));

      const box = screen.getByLabelText("Edit your comment");
      expect(box).toHaveValue("Hi @Cal Example, hello");
      await user.type(box, " there");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(editLessonComment).toHaveBeenCalledWith("cmnt_AAAAAAAAAAA1", `Hi @[${CAL}], hello there`);
    });

    it("counts the stored length, where a mention is longer than its name", async () => {
      suggestCommentMentions.mockResolvedValue([{ memberId: CAL, name: "Al", isInstructor: false }]);
      const user = userEvent.setup();
      renderThread([]);
      const box = screen.getByLabelText("Ask a question or leave a comment");
      await user.click(box);
      await user.paste("x".repeat(3790));
      await user.type(box, " @al");
      await screen.findByRole("listbox");
      await user.keyboard("{Enter}");
      // "@Al" is 3 characters shown, 19 stored.
      expect(screen.getByText(/3,8\d\d of 4,000 characters/)).toBeInTheDocument();
    });
  });
});

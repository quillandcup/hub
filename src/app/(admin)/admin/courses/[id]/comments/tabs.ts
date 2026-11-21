/** Plain module (no component imports): the tabs of a course's comments pages, at /admin/courses/<id>/comments (first) and /admin/courses/<id>/comments/<tab> (src/lib/tab-routes.ts). */
export const COMMENT_TAB_IDS = ["unanswered", "moderation"] as const;
export type CommentTabId = (typeof COMMENT_TAB_IDS)[number];
export const COMMENTS_TITLE = "Comments";
export const COMMENT_TAB_LABELS: Record<CommentTabId, string> = {
  unanswered: "Unanswered questions",
  moderation: "Moderation",
};

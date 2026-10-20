import { explainCourse } from "@/lib/courses/explain";

/**
 * The Kajabi ids of a course's lessons that members can see in the Hub (open or "Coming soon"),
 * by the same rule the Silver processing uses: a draft lesson, or a lesson under a draft module, is
 * not visible. The media steps (videos, downloads) only ever work on these, since drafts are
 * unfinished and every upload costs something. Takes Bronze rows.
 */
export function visibleLessonIds(
  modules: { kajabi_id: string; parent_kajabi_id: string | null; position: number | null; title: string; publishing_option: string | null }[],
  lessons: { kajabi_id: string; module_kajabi_id: string | null; position: number | null; title: string; publishing_option: string | null }[]
): Set<string> {
  const explained = explainCourse(
    modules.map((m) => ({ kajabiId: m.kajabi_id, parentKajabiId: m.parent_kajabi_id, position: m.position, title: m.title, publishingOption: m.publishing_option })),
    lessons.map((l) => ({ kajabiId: l.kajabi_id, moduleKajabiId: l.module_kajabi_id, position: l.position, title: l.title, publishingOption: l.publishing_option }))
  );
  const visible = new Set<string>();
  const walk = (m: (typeof explained.modules)[number]) => {
    m.lessons.forEach((l) => l.state !== "hidden" && visible.add(l.kajabiId));
    m.children.forEach(walk);
  };
  explained.loose.forEach((l) => l.state !== "hidden" && visible.add(l.kajabiId));
  explained.modules.forEach(walk);
  return visible;
}

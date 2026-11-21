import type { TabPanel } from "@/components/Tabs";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import { loadCourseRoster } from "@/lib/courses/roster-data";
import RosterTable from "./roster/RosterTable";
import { COURSE_TAB_LABELS, type CourseTab } from "./course-tabs";

/** Everyone with access, as the Customers tab (the old "Who's where" page), with the count in its label; null when the course has no roster to read. */
export async function customersPanel(id: string): Promise<TabPanel<CourseTab> | null> {
  const data = await loadCourseRoster(createRepos(createServiceRoleClient()), id);
  if (!data) return null;
  return {
    id: "roster",
    label: `${COURSE_TAB_LABELS.roster} (${data.rows.length})`,
    title: COURSE_TAB_LABELS.roster,
    content: (
      <div className="rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">Everyone with access, how many open lessons they have completed and where they last were.</p>
        {data.rows.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">Nobody has access yet.</p> : <RosterTable rows={data.rows} />}
      </div>
    ),
  };
}

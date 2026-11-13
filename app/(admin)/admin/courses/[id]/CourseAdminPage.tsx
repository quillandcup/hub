import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { loadAdminCourse, loadAdminCourseTitle, loadHubCourse, loadHubOutline } from "@/lib/courses/admin";
import { ACCESS_OPTIONS, accessLabel } from "@/lib/courses/access-options";
import { formatCourseDate, formatCourseDateTime } from "@/lib/courses/format";
import { loadDuplicatePreview } from "@/lib/courses/duplicate";
import { loadTakeOverPreview } from "@/lib/courses/take-over";
import { resolveCourseParam } from "@/lib/courses/course-param";
import { isId } from "@/lib/ids";
import { localDateOf } from "@/lib/prickle-writing";
import { ORG_TIMEZONE } from "@/lib/config";
import { tabTitle } from "@/lib/tab-routes";
import { Tabs, type TabPanel } from "@/components/Tabs";
import { InfoTip } from "@/components/InfoTip";
import BuilderOutline from "../BuilderOutline";
import CourseBuilderBanner from "../CourseBuilderBanner";
import CourseDetailsForm from "../CourseDetailsForm";
import CoursePublishControl from "../CoursePublishControl";
import CourseStatusChip from "../CourseStatusChip";
import { customersPanel } from "./customers-panel";
import CourseActions from "./CourseActions";
import CourseFilesPanel from "./CourseFilesPanel";
import CourseKajabiDetails from "./CourseKajabiDetails";
import CourseSettingsForm from "./CourseSettingsForm";
import CourseVideosPanel from "./CourseVideosPanel";
import { COURSE_TAB_LABELS, courseTabIds, type CourseTab } from "./course-tabs";

const PANEL = "rounded-lg bg-white p-3 shadow sm:p-6 dark:bg-slate-900";
const CHIP = "rounded-full border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300";

/** The browser tab's title for one of the course page's tabs: the course first ("Plot Lab · Courses", "Details · Plot Lab · Courses" with the tab in the middle). */
export async function courseTabMetadata(idParam: string, tab: CourseTab): Promise<Metadata> {
  const title = await loadAdminCourseTitle(createRepos(await createClient()), idParam);
  return { title: tabTitle({ record: title ?? undefined, section: "Courses" }, COURSE_TAB_LABELS[tab], tab === "outline") };
}

/**
 * One course in the admin: a compact header (name, state, who has access, the primary action and a
 * ⋯ menu) over tabs, for a course imported from Kajabi (read only until it is taken over) and one the
 * Hub owns (edited here) alike. The tabs are paths: Outline at the base, the rest beside it.
 */
export default async function CourseAdminPage({ idParam, tab }: { idParam: string; tab: CourseTab }) {
  await requireAdminPage();
  const supabase = await createClient();
  const repos = createRepos(supabase);
  // The id or the course's slug (a member's /courses/<slug> address with /admin in front).
  const id = await resolveCourseParam(repos, idParam);
  if (!isId(id, "crs")) notFound();
  const basePath = `/admin/courses/${idParam}`;

  const detail = await loadAdminCourse(repos, id);
  if (!detail) return HubCourse({ id, basePath, tab });
  if (!courseTabIds("kajabi").includes(tab)) notFound();

  const { course, explained, content, hubLessonIds, videos, files, details, lastImportedAt } = detail;
  const hub = course.hub;
  // Only a course that is in the Hub has anything to take over or copy.
  const [takeOver, duplicate] = hub ? await Promise.all([loadTakeOverPreview(repos, id), loadDuplicatePreview(repos, id)]) : [null, null];
  const launchOn = hub?.launchAt ? localDateOf(hub.launchAt, ORG_TIMEZONE) : "";

  const panels: TabPanel<CourseTab>[] = [
    {
      id: "outline",
      label: COURSE_TAB_LABELS.outline,
      title: COURSE_TAB_LABELS.outline,
      content: (
        <div className={PANEL}>
          <BuilderOutline course={{ id, slug: hub?.slug ?? null, loose: explained.loose, modules: explained.modules, content, hubLessonIds }} />
        </div>
      ),
    },
    {
      id: "details",
      label: COURSE_TAB_LABELS.details,
      title: COURSE_TAB_LABELS.details,
      content: (
        <div className="space-y-6">
          <div className={PANEL}>
            <h2 className="mb-3 text-lg font-semibold">In the Hub</h2>
            {hub ? (
              <>
                <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
                  Members open it at <code>/courses/{hub.slug}</code>. Access {accessLabel(hub.accessDuration).toLowerCase()}
                  {hub.launchAt && `, opens ${formatCourseDate(hub.launchAt)}`}.
                </p>
                <CourseSettingsForm slug={hub.slug} accessDuration={hub.accessDuration} launchOn={launchOn} />
              </>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Not in the Hub yet. It gets its page after the next Kajabi import from{" "}
                <Link href="/admin/data/import" className="underline">
                  Import Data
                </Link>
                .
              </p>
            )}
          </div>
          <div className={PANEL}>
            <h2 className="mb-1 text-lg font-semibold">As imported from Kajabi</h2>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">Read only here until you take the course over.</p>
            <CourseKajabiDetails
              title={course.title}
              slug={hub?.slug ?? null}
              description={details.description}
              accessDuration={hub ? hub.accessDuration : undefined}
              launchOn={launchOn}
              includesMembership={details.includesMembership}
            />
          </div>
        </div>
      ),
    },
    {
      id: "media",
      label: COURSE_TAB_LABELS.media,
      title: COURSE_TAB_LABELS.media,
      content: (
        <>
          <CourseVideosPanel slug={hub?.slug ?? null} videos={videos} />
          <CourseFilesPanel slug={hub?.slug ?? null} plan={files} />
        </>
      ),
    },
  ];

  const customers = await customersPanel(id);
  if (customers) panels.push(customers);
  if (tab === "roster" && !customers) notFound();

  return (
    <>
      <CourseBuilderBanner />
      <div className="@container container mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-8">
        <CourseHeader
          title={course.title}
          courseId={id}
          isDraft={course.isDraft}
          inHub={!!hub}
          chip="Imported from Kajabi"
          summary={
            <>
              {hub && `${course.access.current} have access now, ${course.access.upcoming} start later, ${course.access.ended} have ended. `}
              {lastImportedAt ? `Last imported from Kajabi ${formatCourseDateTime(lastImportedAt)}.` : "Not imported from Kajabi yet."}
              <span className="ml-1 inline-flex align-middle">
                <InfoTip label="How lessons open">
                  {explained.totals.open} lessons open, {explained.totals.coming_soon} coming soon, {explained.totals.hidden} hidden. A lesson is open only when it and every module above it are Published in Kajabi; Locked shows
                  as coming soon and Draft is hidden from members. You can preview coming-soon lessons and drafts; members never see drafts.
                </InfoTip>
              </span>
            </>
          }
          duplicate={duplicate}
          takeOver={takeOver}
        />
        <Tabs key={tab} tabs={panels.filter((p) => courseTabIds("kajabi").includes(p.id))} initialTab={tab} basePath={basePath} pageTitle={{ record: course.title, section: "Courses" }} className="mt-6" />
      </div>
    </>
  );
}

/** The admin page of a course the Hub owns: the same header and tabs, with the outline and details editable. */
async function HubCourse({ id, basePath, tab }: { id: string; basePath: string; tab: CourseTab }) {
  const repos = createRepos(await createClient());
  const [course, programs, outline, duplicate] = await Promise.all([loadHubCourse(repos, id), repos.programs.names(), loadHubOutline(repos, id), loadDuplicatePreview(repos, id)]);
  if (!course || !courseTabIds("hub").includes(tab)) notFound();

  const accessIndex = ACCESS_OPTIONS.findIndex((o) => accessLabel(o.value) === accessLabel(course.accessDuration));
  const panels: TabPanel<CourseTab>[] = [
    {
      id: "outline",
      label: COURSE_TAB_LABELS.outline,
      title: COURSE_TAB_LABELS.outline,
      content: (
        <div className={PANEL}>
          {/* A Hub-owned lesson is its own Hub lesson, so its preview link takes its own id. */}
          <BuilderOutline course={{ id: course.id, slug: course.slug, editable: true, ...outline, hubLessonIds: Object.fromEntries(Object.keys(outline.content).map((lessonId) => [lessonId, lessonId])) }} />
        </div>
      ),
    },
    {
      id: "details",
      label: COURSE_TAB_LABELS.details,
      title: COURSE_TAB_LABELS.details,
      content: (
        <div className="max-w-3xl">
          <CourseDetailsForm
            courseId={course.id}
            everPublished={course.everPublished}
            initial={{
              title: course.title,
              slug: course.slug,
              description: course.description ?? "",
              accessChoice: accessIndex === -1 ? "" : String(accessIndex),
              launchOn: course.launchAt ? localDateOf(course.launchAt, ORG_TIMEZONE) : "",
              programId: course.programId ?? "",
            }}
            programs={programs}
          />
        </div>
      ),
    },
  ];

  const customers = await customersPanel(course.id);
  if (customers) panels.push(customers);
  if (tab === "roster" && !customers) notFound();

  return (
    <div className="@container container mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-8">
      <CourseHeader
        title={course.title}
        courseId={course.id}
        isDraft={course.isDraft}
        inHub
        chip="In the Hub"
        summary={
          <>
            {[`${course.access.current} have access now`, `${course.access.upcoming} start later`, course.access.ended > 0 && `${course.access.ended} have ended`, course.launchAt && `opens ${formatCourseDate(course.launchAt)}`].filter(Boolean).join(" · ")}
          </>
        }
        duplicate={duplicate}
        takeOver={null}
      />
      <Tabs key={tab} tabs={panels} initialTab={tab} basePath={basePath} pageTitle={{ record: course.title, section: "Courses" }} className="mt-6" />
    </div>
  );
}

/** Back link, name, state chips, one line of summary, and on the right the ⋯ menu and the publish button. */
function CourseHeader({
  title,
  courseId,
  isDraft,
  inHub,
  chip,
  summary,
  duplicate,
  takeOver,
}: {
  title: string;
  courseId: string;
  isDraft: boolean;
  /** Whether the course has a Hub page to publish; an imported course gets one after the next import. */
  inHub: boolean;
  chip: string;
  summary: React.ReactNode;
  duplicate: React.ComponentProps<typeof CourseActions>["duplicate"];
  takeOver: React.ComponentProps<typeof CourseActions>["takeOver"];
}) {
  return (
    <header>
      <Link href="/admin/courses" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← Courses
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold @pair:text-3xl">{title}</h1>
            <CourseStatusChip isDraft={isDraft} />
            <span className={CHIP}>{chip}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CourseActions courseId={courseId} title={title} duplicate={duplicate} takeOver={takeOver} />
          {inHub && <CoursePublishControl courseId={courseId} isDraft={isDraft} compact />}
        </div>
      </div>
    </header>
  );
}

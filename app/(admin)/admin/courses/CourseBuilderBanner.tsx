import PageBanner from "@/components/PageBanner";
import { SUPPORT_EMAIL } from "@/lib/config";

/** Shown above a course imported from Kajabi: it is rebuilt from Kajabi on every sync, so it can't be edited here. */
export default function CourseBuilderBanner() {
  return (
    <PageBanner>
      Courses imported from Kajabi can&apos;t be edited here yet. To add or change one, contact support at{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
        {SUPPORT_EMAIL}
      </a>{" "}
      and we&apos;ll import it from Kajabi for you.
    </PageBanner>
  );
}

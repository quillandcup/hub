import PageBanner from "@/components/PageBanner";
import { SUPPORT_EMAIL } from "@/lib/config";

/** Shown above the course builder while it can't save: courses are imported from Kajabi by hand. */
export default function CourseBuilderBanner() {
  return (
    <PageBanner>
      Building courses here isn&apos;t available yet. To add or change a course, contact support at{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
        {SUPPORT_EMAIL}
      </a>{" "}
      and we&apos;ll import it from Kajabi for you.
    </PageBanner>
  );
}

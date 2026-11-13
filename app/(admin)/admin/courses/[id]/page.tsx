import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import CourseAdminPage, { courseTabMetadata } from "./CourseAdminPage";

/** The tab shows the course's name first ("The Ready Writer · Courses"), like other record pages. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return courseTabMetadata((await params).id, "outline");
}

/** The admin page for one course, first tab (Outline): imported from Kajabi (read only until taken over) or owned by the Hub (edited here). */
export default async function AdminCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  return <CourseAdminPage idParam={(await params).id} tab="outline" />;
}

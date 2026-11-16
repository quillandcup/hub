import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import CourseAdminPage, { courseTabMetadata } from "../CourseAdminPage";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return courseTabMetadata((await params).id, "details");
}

/** The course's Details tab. */
export default async function AdminCourseDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  return <CourseAdminPage idParam={(await params).id} tab="details" />;
}

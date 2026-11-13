import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import CourseAdminPage, { courseTabMetadata } from "../CourseAdminPage";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return courseTabMetadata((await params).id, "media");
}

/** The course's Media tab (videos and downloads of a course imported from Kajabi). */
export default async function AdminCourseMediaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  return <CourseAdminPage idParam={(await params).id} tab="media" />;
}

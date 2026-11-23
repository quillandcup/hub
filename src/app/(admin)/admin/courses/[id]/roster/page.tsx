import type { Metadata } from "next";
import { requirePermission } from "@/lib/admin-auth";
import CourseAdminPage, { courseTabMetadata } from "../CourseAdminPage";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return courseTabMetadata((await params).id, "roster");
}

/** The course's Customers tab (everyone with access). It keeps the address the old "Who's where" page had, so existing links still work. */
export default async function CourseRosterPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("courses.manage");
  return <CourseAdminPage idParam={(await params).id} tab="roster" />;
}

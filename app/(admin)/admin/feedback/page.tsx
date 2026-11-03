import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import FeedbackClient from "./FeedbackClient";
import { requireAdminPage } from "@/lib/admin-auth";
import { isId } from "@/lib/ids";

export const metadata: Metadata = {
  title: "Feedback",
};

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  await requireAdminPage();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // ?member= narrows the list to one member's feedback (the Activity Log's link): a readable member id, never a feedback id.
  const { member } = await searchParams;
  return <FeedbackClient memberId={member && isId(member, "mbr") ? member : undefined} />;
}

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import FeedbackClient from "./FeedbackClient";

export const metadata: Metadata = {
  title: "Feedback",
};

export default async function FeedbackPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <FeedbackClient />;
}

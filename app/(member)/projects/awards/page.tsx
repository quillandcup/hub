import type { Metadata } from "next";
import { tabTitle } from "@/lib/tab-routes";
import ProjectsPage, { MY_WRITING_TITLE, MY_WRITING_TAB_LABELS } from "../ProjectsPage";

export const metadata: Metadata = { title: tabTitle({ section: MY_WRITING_TITLE }, MY_WRITING_TAB_LABELS.awards, false) };

export default function MyAwardsPage() {
  return <ProjectsPage tab="awards" />;
}

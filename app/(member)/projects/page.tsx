import type { Metadata } from "next";
import { redirectLegacyTabParam } from "@/lib/tab-routes";
import ProjectsPage, { MY_WRITING_TAB_IDS, MY_WRITING_TITLE } from "./ProjectsPage";

export const metadata: Metadata = { title: MY_WRITING_TITLE };

/** My Writing, Projects tab. Legacy ?tab=<id> links redirect to /projects/<id>. */
export default async function MyWritingIndex({ searchParams }: PageProps<"/projects">) {
  redirectLegacyTabParam("/projects", MY_WRITING_TAB_IDS, await searchParams);
  return <ProjectsPage tab="projects" />;
}

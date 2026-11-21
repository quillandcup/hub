"use client";

import { useState, type ComponentProps } from "react";
import type { StageMilestonePrompt } from "@/lib/milestone-prompts";
import ProjectDetailClient from "./ProjectDetailClient";
import StageMilestoneDialog from "./StageMilestoneDialog";

/**
 * The project page and, above it, the milestone prompt that follows a status change. The page below is keyed on the saved phase
 * and level (it starts again when they change), so the dialog lives here, outside that key: the status saving must not close the
 * question it just raised.
 */
export default function ProjectDetailView({ viewKey, ...props }: ComponentProps<typeof ProjectDetailClient> & { viewKey: string }) {
  const [prompt, setPrompt] = useState<StageMilestonePrompt | null>(null);
  // Counts up each time the dialog asks to open the Publish flow; the page opens it once per change.
  const [publishRequests, setPublishRequests] = useState(0);
  return (
    <>
      <ProjectDetailClient key={viewKey} {...props} onStageMilestonePrompt={setPrompt} publishRequests={publishRequests} />
      {prompt && (
        <StageMilestoneDialog
          prompt={prompt}
          onClose={() => setPrompt(null)}
          onPublish={() => {
            setPrompt(null);
            setPublishRequests((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

"use client";

import { stopRolePreview } from "@/app/actions/staff-preview";
import AnnouncementBar from "@/components/announcements/AnnouncementBar";

/** Shown across the top of the admin area while an admin previews a lower staff role. */
export default function RolePreviewBanner({ roleLabel }: { roleLabel: string }) {
  return (
    <AnnouncementBar tone="critical" aria-label="Role preview" action={{ label: "Exit preview", track: "role-preview-exit", formAction: stopRolePreview }}>
      <span className="font-medium">
        Previewing as <strong>{roleLabel}</strong>: you see the pages and controls they have, but you still read data with admin access.
      </span>
    </AnnouncementBar>
  );
}

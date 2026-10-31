import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryZoomRepository } from "@/lib/data/zoom";
import { defineZoomContract } from "@/tests/helpers/zoom-contract";

defineZoomContract("InMemoryZoomRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryZoomRepository(data),
    unique: (label) => `zoom-${label}-${++n}`,
    members: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
    prickles: ["prkl_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA2"],
    clear: async () => {
      data.zoomAttendees = [];
      data.zoomMeetings = [];
      data.ignoredZoomNames = [];
      data.ignoredZoomAppearances = [];
      data.ambiguousZoomNames = [];
      data.zoomParticipantEvents = [];
    },
    seedAmbiguousName: async ({ zoomName, zoomEmail, candidates, status = "unresolved", resolvedMemberId }) => {
      data.ambiguousZoomNames.push({
        id: crypto.randomUUID(),
        zoom_name: zoomName,
        zoom_email: zoomEmail,
        candidate_member_ids: candidates,
        status,
        resolved_member_id: resolvedMemberId ?? null,
        first_seen_at: null,
        last_seen_at: null,
        occurrence_count: 1,
        notes: null,
        created_at: null,
        updated_at: null,
      });
    },
    ambiguousNamed: async (zoomName) =>
      data.ambiguousZoomNames
        .filter((r) => r.zoom_name === zoomName)
        .map(({ zoom_email, status, resolved_member_id, candidate_member_ids }) => ({ zoom_email, status, resolved_member_id, candidate_member_ids })),
  };
});

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MemberSearch from "@/components/MemberSearch";
import { getMemberDisplayName } from "@/lib/member-display-name";
import type { PrickleDetail } from "@/lib/domain/prickle";
import type { PrickleEdits } from "@/lib/prickle-edits";

export type { PrickleEdits };

/** What the admin prickle page hands the details card to make it editable. */
export interface PrickleEditConfig {
  types: { id: string; name: string }[];
  members: { id: string; name: string; email: string; displayName?: string | null }[];
  /** The text fields an admin has set by hand; the others follow the calendar. */
  overridden: { title: boolean; description: boolean; guestSpeaker: boolean; location: boolean };
  onSave: (edits: PrickleEdits) => Promise<{ success?: true; error?: string }>;
}

const INPUT = "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 rounded";
const LABEL = "block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300";

/**
 * The inline form that replaces the title, description, type, host and guest speaker on the prickle details
 * card. Save sends only what changed, so saving untouched sets nothing; a text field emptied follows the calendar again.
 */
export default function PrickleEditForm({
  prickle,
  edit,
  onDone,
}: {
  prickle: PrickleDetail;
  edit: PrickleEditConfig;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(prickle.title ?? "");
  const [description, setDescription] = useState(prickle.description ?? "");
  const [guestSpeaker, setGuestSpeaker] = useState(prickle.guestSpeaker ?? "");
  const [location, setLocation] = useState(prickle.location ?? "");
  const [typeId, setTypeId] = useState(prickle.typeId ?? "");
  // The host as the community knows them (their display name), until another member is picked.
  const [pickedHost, setPickedHost] = useState<{ id: string; label: string } | null>(
    prickle.host ? { id: prickle.host.id, label: getMemberDisplayName({ name: prickle.host.name, display_name: prickle.host.displayName }) } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const edits: PrickleEdits = {};
    if (title.trim() !== (prickle.title ?? "").trim()) edits.title = title;
    if (description.trim() !== (prickle.description ?? "").trim()) edits.description = description;
    if (guestSpeaker.trim() !== (prickle.guestSpeaker ?? "").trim()) edits.guestSpeaker = guestSpeaker;
    if (location.trim() !== (prickle.location ?? "").trim()) edits.location = location;
    if (typeId && typeId !== prickle.typeId) edits.typeId = typeId;
    if (pickedHost && pickedHost.id !== prickle.host?.id) edits.hostId = pickedHost.id;

    if (Object.keys(edits).length === 0) {
      onDone();
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await edit.onSave(edits);
      if (result.error) {
        setError(result.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  const edited = (isEdited: boolean) => (isEdited ? <span className="ml-1 text-xs font-normal text-plum-600 dark:text-plum-400">(edited)</span> : null);

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div>
        <label htmlFor="prickle-title" className={LABEL}>
          Title{edited(edit.overridden.title)}
        </label>
        <input id="prickle-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor="prickle-description" className={LABEL}>
          Description{edited(edit.overridden.description)}
        </label>
        <textarea id="prickle-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT} />
      </div>
      <div className="@container">
        <div className="grid grid-cols-1 @pair:grid-cols-2 gap-4">
          <div>
            <label htmlFor="prickle-type" className={LABEL}>
              Type
            </label>
            <select id="prickle-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={INPUT}>
              {!prickle.typeId && <option value="">Unknown</option>}
              {edit.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={LABEL}>Host</span>
            <MemberSearch
              members={edit.members}
              selectedMemberId={pickedHost?.id ?? null}
              selectedMemberName={pickedHost?.label}
              onSelect={(member) => setPickedHost(member ? { id: member.id, label: getMemberDisplayName({ name: member.name, display_name: member.displayName }) } : null)}
              placeholder="Search for the host..."
            />
          </div>
          <div>
            <label htmlFor="prickle-guest-speaker" className={LABEL}>
              Guest speaker{edited(edit.overridden.guestSpeaker)}
            </label>
            <input id="prickle-guest-speaker" type="text" value={guestSpeaker} onChange={(e) => setGuestSpeaker(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="prickle-location" className={LABEL}>
              Location{edited(edit.overridden.location)}
            </label>
            <input id="prickle-location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={INPUT} />
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Leave the title, description, guest speaker or location empty to follow the calendar. Pick another member to change the host (cleared, the host stays as it is). The date and time come from the calendar.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="px-4 py-2 bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50 text-sm"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onDone}
          className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

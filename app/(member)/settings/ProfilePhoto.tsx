"use client";

import { useRef, useState, type ChangeEvent } from "react";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { MEMBER_PHOTO } from "@/lib/config";
import type { PhotoSource } from "@/lib/members/photo";
import type { Visibility } from "@/lib/writing-visibility";

const BUTTON_CLASS =
  "px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

const MAX_MB = Math.floor(MEMBER_PHOTO.maxUploadBytes / (1024 * 1024));

/** Where the picture comes from, in plain words. */
export const SOURCE_TEXT: Record<PhotoSource, string> = {
  uploaded: "A photo you uploaded.",
  gravatar_copy: "A copy of your Gravatar picture, saved here.",
  gravatar: "Your Gravatar picture: it is found from your email address, and it is not saved here.",
  slack: "Your Slack profile photo.",
  kajabi: "The photo from when you joined.",
  other: "A photo we found for you.",
  none: "You have no photo yet.",
};

/** What the lock, house or globe means for the photo, in plain words. */
export function whoSeesPhoto(level: Visibility, source: PhotoSource, webOpen: boolean): string {
  const initials = "other members see your initials instead";
  if (level === "private") return `Only you see your photo; ${initials}.`;
  if (level === "community") return source === "none" ? "Other members see your initials until you add a photo." : "Other members see your photo.";
  const web = webOpen ? " and anyone on the web sees it on your writer profile once it is on" : "";
  return source === "none" ? "Other members see your initials until you add a photo." : `Other members see your photo${web}.`;
}

/**
 * The photo row of Settings > Profile: the picture in use and where it comes from, upload and remove, and what the lock, house and
 * globe mean for it (docs/product/WRITER_PROFILES.md, "The photo"). The server checks and shrinks the file (`/api/profile/photo`);
 * `onChanged` asks the panel to reload. While staff look as the member (sudo) it only shows.
 */
export default function ProfilePhoto({
  photo,
  level,
  webOpen,
  onChanged,
}: {
  photo: { name: string; url: string | null; source: PhotoSource; canChange: boolean };
  level: Visibility;
  /** Writer profiles are open to this member, so the globe is offered. */
  webOpen: boolean;
  onChanged: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const own = photo.source === "uploaded" || photo.source === "gravatar_copy";

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProblem(null);
    setDone(null);
    if (file.size > MEMBER_PHOTO.maxUploadBytes) return setProblem(`Use a photo of ${MAX_MB} MB or less.`);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("photo", file);
      const response = await fetch("/api/profile/photo", { method: "POST", body });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) return setProblem(result.error ?? "Couldn't save your photo. Please try again.");
      setDone("Photo saved.");
      await onChanged();
    } catch {
      setProblem("Couldn't save your photo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<string | undefined> {
    const response = await fetch("/api/profile/photo", { method: "DELETE" }).catch(() => null);
    const result = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!response?.ok) return result?.error ?? "Couldn't remove your photo. Please try again.";
    setProblem(null);
    setDone("Photo removed.");
    await onChanged();
    return undefined;
  }

  return (
    <div className="mt-2 flex items-start gap-3">
      <MemberAvatar name={photo.name} photoUrl={photo.url} size={64} />
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-slate-600 dark:text-slate-400">{SOURCE_TEXT[photo.source]}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400">{whoSeesPhoto(level, photo.source, webOpen)}</p>
        {photo.canChange && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="sr-only" aria-label="Choose a photo to upload" tabIndex={-1} />
            <button type="button" data-track="settings-profile-photo-upload" disabled={busy} onClick={() => input.current?.click()} className={BUTTON_CLASS}>
              {busy ? "Saving…" : own ? "Replace photo" : "Upload a photo"}
            </button>
            {own && (
              <button type="button" data-track="settings-profile-photo-remove" disabled={busy} onClick={() => setConfirmRemove(true)} className={BUTTON_CLASS}>
                Remove photo
              </button>
            )}
          </div>
        )}
        {photo.canChange && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            A JPEG, PNG or WebP of {MAX_MB} MB or less. We make it smaller and remove hidden details such as where it was taken.
            {webOpen && photo.source === "gravatar" && " Choosing the globe saves a copy of your Gravatar picture here once, because its web address contains a code made from your email; the copy is what the web shows."}
          </p>
        )}
        {(problem || done) && (
          <p role="status" className={`text-xs ${problem ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
            {problem ?? done}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove your photo?"
        body="The photo saved here is deleted and can't be brought back. Until you add another, other members see the picture we find for you (your Gravatar picture, if you have one) or your initials."
        confirmLabel="Remove photo"
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}

"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { MILESTONE_PHOTO } from "@/lib/config";
import { MILESTONE_PHOTO_ALT, MILESTONE_PHOTO_PROMPT } from "@/lib/finishers";
import { MAX_MILESTONE_UPLOAD_LABEL, milestonePhotoSrc, type PhotoTarget, type StepPhoto } from "@/lib/milestone-photos";
import { useConfirm } from "@/components/ConfirmDialog";
import { setMilestonePhotoAlt } from "@/app/(member)/settings/milestoneActions";

const INPUT = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const SECONDARY = "px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50";
const NOTE = "text-xs text-slate-600 dark:text-slate-400";

/**
 * The photo on one step of a work (docs/product/FINISHERS.md, "Photos"): a small preview, "Add a photo" / "Change photo" / "Remove
 * photo", what it shows (optional, for people who cannot see it) and one line that says who can see it, which is the step's own
 * level. The picture is sent to `POST /api/milestone-photos`, which checks and re-encodes it; this component never holds a path
 * or an address of the file, only the token the route is asked for. `kind` picks the words; `target` and `id` say where it goes
 * ("milestone" for THE END and publish-ready, "book" for the Published step).
 */
export default function MilestonePhoto({
  target,
  id,
  kind,
  photo,
  visibilityLine,
  readOnly,
  idPrefix,
}: {
  target: PhotoTarget;
  id: string;
  kind: keyof typeof MILESTONE_PHOTO_ALT;
  photo: StepPhoto | null;
  visibilityLine: string;
  readOnly: boolean;
  idPrefix: string;
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alt, setAlt] = useState(photo?.alt ?? "");
  const [savedAlt, setSavedAlt] = useState(photo?.alt ?? "");
  // What the member sees at once after a change; the page's own copy takes over on the refresh.
  const [token, setToken] = useState<string | null>(photo?.token ?? null);
  const working = busy || pending;

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MILESTONE_PHOTO.maxUploadBytes) {
      setError(`Use a photo of ${MAX_MILESTONE_UPLOAD_LABEL} or less.`);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("photo", file);
      body.set("target", target);
      body.set("id", id);
      // A new photo is a new picture: what the old one showed is not carried over.
      body.set("alt", "");
      const response = await fetch("/api/milestone-photos", { method: "POST", body });
      const result = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!response.ok || !result.token) {
        setError(result.error ?? "We couldn't save that photo. Please try again.");
        return;
      }
      setToken(result.token);
      setAlt("");
      setSavedAlt("");
      router.refresh();
    } catch {
      setError("We couldn't save that photo. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await ask({
      title: "Remove this photo?",
      body: "It is deleted and no one can see it anymore. You can't get it back, but you can add a photo again.",
      confirmLabel: "Remove photo",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/milestone-photos?target=${target}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        setError(result.error ?? "We couldn't remove that photo. Please try again.");
        return;
      }
      setToken(null);
      setAlt("");
      setSavedAlt("");
      router.refresh();
    } catch {
      setError("We couldn't remove that photo. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveAlt = () =>
    startTransition(async () => {
      setError(null);
      const result = await setMilestonePhotoAlt(target, id, alt);
      if ("error" in result) setError(result.error);
      else {
        setSavedAlt(alt.trim());
        router.refresh();
      }
    });

  return (
    <div className="mt-3 rounded-md bg-slate-50 dark:bg-slate-800/50 p-3" data-testid={`milestone-photo-${idPrefix}`}>
      {!token && <p className="text-sm text-slate-700 dark:text-slate-300">{MILESTONE_PHOTO_PROMPT[kind]}</p>}
      {token && (
        <div className="@container">
        <div className="flex flex-col gap-3 @pair:flex-row @pair:items-start">
          {/* A fixed-shape box, so nothing moves while the picture loads; the whole picture is shown, never cropped. */}
          <div className="aspect-[4/3] w-40 shrink-0 overflow-hidden rounded-md bg-slate-200 dark:bg-slate-700">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in photo from our own route: the image optimizer cannot reach it */}
            <img src={milestonePhotoSrc(token)} alt={savedAlt || MILESTONE_PHOTO_ALT[kind]} loading="lazy" decoding="async" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${idPrefix}-photo-alt`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              What does the photo show? (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id={`${idPrefix}-photo-alt`}
                value={alt}
                maxLength={MILESTONE_PHOTO.altMaxLength}
                onChange={(e) => setAlt(e.target.value)}
                disabled={readOnly || working}
                placeholder="Me at my desk with a cup of tea"
                className={`${INPUT} min-w-0 flex-1`}
              />
              {alt.trim() !== savedAlt && (
                <button type="button" onClick={saveAlt} disabled={readOnly || working} className={SECONDARY}>
                  Save
                </button>
              )}
            </div>
            <p className={`mt-1 ${NOTE}`}>People who can&rsquo;t see the picture hear this instead.</p>
          </div>
        </div>
        </div>
      )}
      <p className={`mt-2 ${NOTE}`} data-testid="milestone-photo-line">
        {visibilityLine}
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="sr-only" aria-label={token ? "Choose a new photo" : "Choose a photo"} tabIndex={-1} />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={readOnly || working} className={SECONDARY} data-track={`milestone-photo-${token ? "change" : "add"}`}>
          {busy ? "Saving..." : token ? "Change photo" : "Add a photo"}
        </button>
        {token && (
          <button type="button" onClick={remove} disabled={readOnly || working} className={SECONDARY}>
            Remove photo
          </button>
        )}
      </div>
      <p className={`mt-1 ${NOTE}`}>A JPEG, PNG or WebP photo, up to {MAX_MILESTONE_UPLOAD_LABEL}. We remove the details saved in it, like where it was taken.</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}

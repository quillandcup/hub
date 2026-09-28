"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  getProfileSettings,
  updateInstagramHandle,
  updateProfileDetails,
  type ProfileSettings,
  type UpdateProfileResult,
} from "./profileActions";
import { parseInstagramInput } from "@/lib/kajabi/profile-fields";
import { MAX_BIO_LENGTH, parseBioInput, parseFacebookInput, parseXInput } from "@/lib/social-links";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const SAVE_CLASS =
  "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";

/** How a stored handle shows in the input: always with a leading @, or empty. */
function formatHandle(handle: string | null): string {
  return handle ? `@${handle.replace(/^@+/, "")}` : "";
}

/** Under each bio/link field: how to hide it, plus a one-click "Remove" while it has a value. */
function ClearHint({ value, noun, onClear }: { value: string; noun: string; onClear: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span>Leave blank to hide your {noun} from your profile.</span>
      {value.trim() && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Remove ${noun}`}
          className="shrink-0 underline hover:text-slate-700 dark:hover:text-slate-200"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * Settings > Profile: everything on the public member profile a member can
 * change, saved together without leaving the Hub. Instagram goes to Kajabi's
 * "Instagram Handle" field; bio / Facebook / X are Hub-owned overrides.
 */
export function ProfilePanel() {
  const [data, setData] = useState<ProfileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [instagramInput, setInstagramInput] = useState("");
  const [bioInput, setBioInput] = useState("");
  const [facebookInput, setFacebookInput] = useState("");
  const [xInput, setXInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getProfileSettings();
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setData(result);
      setInstagramInput(formatHandle(result.instagramHandle));
      setBioInput(result.details.bio ?? "");
      setFacebookInput(result.details.facebookUrl ?? "");
      setXInput(result.details.twitterUrl ?? "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setError(null);
    setMessage(null);
    const bio = parseBioInput(bioInput);
    const instagram = parseInstagramInput(instagramInput);
    const facebook = parseFacebookInput(facebookInput);
    const x = parseXInput(xInput);
    if ("error" in bio) return setError(bio.error);
    if (data.kajabiLinked && "error" in instagram) return setError(`Instagram: ${instagram.error}`);
    if ("error" in facebook) return setError(`Facebook: ${facebook.error}`);
    if ("error" in x) return setError(`X: ${x.error}`);

    // Instagram lives in Kajabi, so only call out to it when the handle actually changed.
    const instagramChanged = data.kajabiLinked && instagramInput.trim() !== formatHandle(data.instagramHandle);

    setSaving(true);
    const results = await Promise.all([
      updateProfileDetails({ bio: bioInput, facebook: facebookInput, x: xInput }),
      ...(instagramChanged ? [updateInstagramHandle(instagramInput)] : []),
    ]);
    setSaving(false);

    // Keep the typed values on failure; a retry re-sends them and the server skips whatever already saved.
    const failed = results.find((r) => "error" in r);
    if (failed && "error" in failed) return setError(failed.error);
    const saved = results.filter((r): r is Extract<UpdateProfileResult, { success: true }> => "success" in r);
    setMessage(
      saved.find((r) => r.warning)?.warning ??
        (saved.some((r) => r.syncPending) ? "Saved. Your profile will update in a minute or two." : "No changes to save.")
    );
    await load();
  }

  if (loading && !data) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-md" />
        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-md" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Couldn't load your profile."}</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">Public Profile</h2>
          {data.syncPending && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Syncing to your profile…
            </span>
          )}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Shown on your{" "}
          <Link href={`/members/${data.memberId}`} className="underline">
            member profile
          </Link>
          .
        </p>
      </div>

      {(error || message) && (
        <div role="status" className="text-sm">
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
          {!error && message && <span className="text-green-600 dark:text-green-400">{message}</span>}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4 max-w-md">
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label htmlFor="profile-bio" className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Bio
            </label>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {bioInput.trim().length}/{MAX_BIO_LENGTH}
            </span>
          </div>
          <textarea
            id="profile-bio"
            value={bioInput}
            onChange={(e) => setBioInput(e.target.value)}
            rows={5}
            maxLength={MAX_BIO_LENGTH + 50}
            placeholder="A little about you and your writing"
            className={INPUT_CLASS}
          />
          <ClearHint value={bioInput} noun="bio" onClear={() => setBioInput("")} />
        </div>
        {/* Instagram — written to Kajabi's "Instagram Handle" contact custom field. */}
        <div>
          <label htmlFor="profile-instagram" className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
            Instagram
          </label>
          {data.kajabiLinked ? (
            <>
              <input
                id="profile-instagram"
                type="text"
                value={instagramInput}
                onChange={(e) => setInstagramInput(e.target.value)}
                placeholder="@yourname"
                maxLength={200}
                autoComplete="off"
                className={INPUT_CLASS}
              />
              {data.instagramFallbackUrl ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  If you leave it blank, your profile links to {data.instagramFallbackUrl} instead.
                </p>
              ) : (
                <ClearHint value={instagramInput} noun="Instagram" onClear={() => setInstagramInput("")} />
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Instagram isn&apos;t set up for your account yet. Email{" "}
              <a href="mailto:support@quillandcup.com" className="underline">
                support@quillandcup.com
              </a>{" "}
              and we&apos;ll sort it out.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="profile-facebook" className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
            Facebook
          </label>
          <input
            id="profile-facebook"
            type="text"
            value={facebookInput}
            onChange={(e) => setFacebookInput(e.target.value)}
            placeholder="facebook.com/yourname"
            maxLength={300}
            autoComplete="off"
            className={INPUT_CLASS}
          />
          <ClearHint value={facebookInput} noun="Facebook link" onClear={() => setFacebookInput("")} />
        </div>
        <div>
          <label htmlFor="profile-x" className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
            X / Twitter
          </label>
          <input
            id="profile-x"
            type="text"
            value={xInput}
            onChange={(e) => setXInput(e.target.value)}
            placeholder="@yourname"
            maxLength={300}
            autoComplete="off"
            className={INPUT_CLASS}
          />
          <ClearHint value={xInput} noun="X link" onClear={() => setXInput("")} />
        </div>
        <button type="submit" disabled={saving} className={SAVE_CLASS}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}

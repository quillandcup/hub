"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getProfileSettings, updateInstagramHandle, type ProfileSettings } from "./profileActions";
import { parseInstagramInput } from "@/lib/kajabi/profile-fields";

/**
 * Settings > Profile. Only fields members can actually change from here are
 * shown: Kajabi's API can't write bio / Facebook / X (see
 * lib/kajabi/profile-fields.ts), so those stay display-only on the member
 * profile page rather than appearing here as dead, read-only inputs.
 */
export function ProfilePanel() {
  const [data, setData] = useState<ProfileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [instagramInput, setInstagramInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getProfileSettings();
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setData(result);
      setInstagramInput(result.instagramHandle ? `@${result.instagramHandle.replace(/^@+/, "")}` : "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveInstagram(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const parsed = parseInstagramInput(instagramInput);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }

    setSaving(true);
    const result = await updateInstagramHandle(instagramInput);
    if ("error" in result) {
      setError(result.error);
    } else {
      setMessage(
        result.warning ??
          (result.syncPending ? "Saved. Your profile will update in a minute or two." : "No changes to save.")
      );
      await load();
    }
    setSaving(false);
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
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-1">Public Profile</h2>
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

      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Instagram</h3>
          {data.syncPending && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Syncing to your profile…
            </span>
          )}
        </div>
        {data.kajabiLinked ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Your handle (like @yourname) or instagram.com link.{" "}
              {data.instagramFallbackUrl
                ? `If you leave it blank, your profile links to ${data.instagramFallbackUrl} instead.`
                : "Leave blank to remove it."}
            </p>
            <form onSubmit={handleSaveInstagram} className="flex gap-2 max-w-md">
              <label htmlFor="instagram-handle" className="sr-only">
                Instagram handle
              </label>
              <input
                id="instagram-handle"
                type="text"
                value={instagramInput}
                onChange={(e) => setInstagramInput(e.target.value)}
                placeholder="@yourname"
                maxLength={200}
                autoComplete="off"
                className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
              />
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </form>
          </>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
            Your account isn&apos;t set up for profile editing yet. Email{" "}
            <a href="mailto:support@quillandcup.com" className="underline">
              support@quillandcup.com
            </a>{" "}
            and we&apos;ll sort it out.
          </p>
        )}
      </div>
    </div>
  );
}

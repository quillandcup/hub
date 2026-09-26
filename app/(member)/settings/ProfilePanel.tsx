"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { getProfileSettings, updateInstagramHandle, type ProfileSettings } from "./profileActions";
import { parseInstagramInput } from "@/lib/kajabi/profile-fields";
import { safeUrl } from "@/lib/url";

function ReadOnlyField({ label, value, href }: { label: string; value: string | null; href?: string | null }) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">{label}</dt>
      <dd className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-md bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 whitespace-pre-line break-words">
        {value ? (
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-slate-400 dark:text-slate-500">Not set</span>
        )}
      </dd>
    </div>
  );
}

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
          (result.syncPending
            ? "Saved to Kajabi. Your profile will update in a minute or two."
            : "No changes to save.")
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

  const instagramEditable = data.kajabiLinked && !data.instagramManagedInKajabiProfile;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-1">Public Profile</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your bio and social links come from your Kajabi account and show on your{" "}
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

      {/* Instagram — the one profile field Kajabi's API lets us write (contact custom field). */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Instagram</h3>
          {data.syncPending && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Syncing to your profile…
            </span>
          )}
        </div>
        {instagramEditable ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Your handle (like @yourname) or instagram.com link. Leave blank to remove it.
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
          <div className="max-w-md">
            <dl>
              <ReadOnlyField label="Current link" value={data.instagramUrl} href={safeUrl(data.instagramUrl)} />
            </dl>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {data.kajabiLinked
                ? "This comes from the Instagram link on your Kajabi profile, which takes priority — update it in Kajabi."
                : "Your account isn't linked to Kajabi, so this can't be edited here."}
            </p>
          </div>
        )}
      </div>

      {/* Bio / Facebook / X — Kajabi customer-profile fields with no write API. */}
      <div>
        <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Bio and other links</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Kajabi doesn&apos;t let other apps change these, so edit them on your profile in Kajabi. Changes show up here
          after the next Kajabi sync.
        </p>
        <dl className="space-y-4 max-w-md">
          <ReadOnlyField label="Bio" value={data.bio} />
          <ReadOnlyField label="Facebook" value={data.facebookUrl} href={safeUrl(data.facebookUrl)} />
          <ReadOnlyField label="X / Twitter" value={data.twitterUrl} href={safeUrl(data.twitterUrl)} />
        </dl>
      </div>
    </div>
  );
}

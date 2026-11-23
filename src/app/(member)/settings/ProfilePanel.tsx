"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  getProfileSettings,
  updateAskMeAbout,
  updateInstagramHandle,
  updateProfileDetails,
  type ProfileSettings,
  type UpdateProfileResult,
} from "./profileActions";
import { parseInstagramInput } from "@/lib/kajabi/profile-fields";
import { MAX_BIO_LENGTH, parseBioInput, parseFacebookInput, parseXInput } from "@/lib/social-links";
import { MAX_TOPICS, MAX_TOPIC_LENGTH, normalizeTopics } from "@/lib/ask-me-about";
import TagInput from "@/components/TagInput";
import { SUPPORT_EMAIL } from "@/lib/config";
import { WriterProfilePanel } from "./WriterProfilePanel";
import ProfileItemVisibility from "./ProfileItemVisibility";
import SeparatePublicBio from "./SeparatePublicBio";
import { getMyWriterProfile, type MyWriterProfile } from "./writerProfileActions";
import ProfilePhoto from "./ProfilePhoto";
import { setProfileVisibility } from "./profileVisibilityActions";
import type { ProfileItem } from "@/lib/profile-visibility";
import type { Visibility } from "@/lib/writing-visibility";
import WriterProfileOnNote from "./WriterProfileOnNote";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const SAVE_CLASS =
  "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";

/** Under each bio/link field: how to hide it, plus a one-click "Remove" while it has a value. */
function ClearHint({ value, noun, onClear }: { value: string; noun: string; onClear: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
      <span>Leave blank to hide your {noun} from your profile.</span>
      {value.trim() && (
        <button
          type="button"
          onClick={onClear}
          data-track="settings-profile-remove-field"
          aria-label={`Remove ${noun}`}
          className="shrink-0 underline hover:text-slate-700 dark:hover:text-slate-200"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/** A label with the lock, house or globe of its item on the right. */
function ItemHeader({ children, control }: { children: React.ReactNode; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-1">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/**
 * Settings > Profile: everything on the member profile a member can change, saved together without leaving the Hub, and
 * who can see each item (the lock, house or globe beside it, saved at once). Instagram goes to Kajabi's "Instagram Handle"
 * field; bio / Facebook / X are Hub-owned overrides. Below it, when pages on the web are open to the member, the block
 * about their writer profile (`WriterProfilePanel`). "Who's coming" lives in Preferences (`WhosComingSetting`).
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
  const [topics, setTopics] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<MyWriterProfile | null>(null);
  const [savingItem, setSavingItem] = useState<ProfileItem | null>(null);
  // Set when the member switches their writer profile on: the short confirmation, until they dismiss it or switch it off.
  const [justTurnedOn, setJustTurnedOn] = useState(false);

  // The writer profile's settings: they decide whether a globe is offered and what its note says. A failed read leaves the page block out.
  const loadPage = useCallback(async () => {
    const result = await getMyWriterProfile();
    setPage("error" in result ? null : result);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getProfileSettings();
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setData(result);
      setInstagramInput(result.instagramUrl ?? "");
      setBioInput(result.details.bio ?? "");
      setFacebookInput(result.details.facebookUrl ?? "");
      setXInput(result.details.twitterUrl ?? "");
      setTopics(result.askMeAbout);
    }
    setLoading(false);
  }, []);

  // Only the photo is read again after an upload, a removal or a copy of a Gravatar picture, so what is typed in the form stays.
  const reloadPhoto = useCallback(async () => {
    const result = await getProfileSettings();
    if (!("error" in result)) setData((current) => (current ? { ...current, photo: result.photo } : current));
  }, []);

  useEffect(() => {
    load();
    loadPage();
  }, [load, loadPage]);

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
    const askMeAbout = normalizeTopics(topics);
    if ("error" in askMeAbout) return setError(`Ask me about: ${askMeAbout.error}`);

    // Instagram lives in Kajabi, so only call out to it when the handle actually changed.
    const instagramChanged = data.kajabiLinked && instagramInput.trim() !== (data.instagramUrl ?? "");
    // Topics are Hub-only and show immediately, so they don't count toward "will update in a minute".
    const topicsChanged = askMeAbout.topics.join("\n") !== data.askMeAbout.join("\n");

    setSaving(true);
    const results = await Promise.all([
      updateProfileDetails({ bio: bioInput, facebook: facebookInput, x: xInput }),
      ...(instagramChanged ? [updateInstagramHandle(instagramInput)] : []),
      ...(topicsChanged ? [updateAskMeAbout(askMeAbout.topics)] : []),
    ]);
    setSaving(false);

    // Keep the typed values on failure; a retry re-sends them and the server skips whatever already saved.
    const failed = results.find((r) => "error" in r);
    if (failed && "error" in failed) return setError(failed.error);
    const saved = results.filter((r): r is Extract<UpdateProfileResult, { success: true }> => "success" in r);
    setMessage(
      saved.find((r) => r.warning)?.warning ??
        (saved.some((r) => r.syncPending)
          ? "Saved. Your profile will update in a minute or two."
          : topicsChanged
            ? "Saved."
            : "No changes to save.")
    );
    await load();
  }

  // A level is saved the moment it is clicked, apart from the form's Save. It shows at once and goes back when the save fails.
  async function handleVisibility(item: ProfileItem, next: Visibility) {
    if (!data) return;
    setError(null);
    setMessage(null);
    const before = data.visibilities[item];
    setData({ ...data, visibilities: { ...data.visibilities, [item]: next } });
    setSavingItem(item);
    const result = await setProfileVisibility(item, next);
    setSavingItem(null);
    if ("error" in result) {
      setData((current) => (current ? { ...current, visibilities: { ...current.visibilities, [item]: before } } : current));
      setError(result.error);
    } else if (item === "photo") {
      // The globe on a Gravatar picture saves a copy of it, which changes the photo shown here.
      await reloadPhoto();
    }
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

  const web = { available: page?.available ?? false, on: page?.isPublic ?? false };
  const separateBio = (page?.publicBio ?? "").trim() !== "";
  const level = (item: ProfileItem) => data.visibilities[item];
  const control = (item: ProfileItem) => (
    <ProfileItemVisibility
      item={item}
      visibility={level(item)}
      page={web}
      disabled={savingItem === item}
      onChange={(next) => void handleVisibility(item, next)}
      separateBio={item === "bio" ? separateBio : undefined}
    />
  );

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">Profile</h2>
          {data.syncPending && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Syncing to your profile…
            </span>
          )}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          What other members see on your{" "}
          <Link data-track="settings-profile-member-profile" href={`/members/${data.memberId}`} className="underline">
            member profile
          </Link>
          . The icon beside each item says who can see it: the lock is only you, the house is other members
          {web.available ? ", and the globe is anyone on the internet, on your writer profile below" : ""}. Click it to change it.
        </p>
      </div>

      {(error || message) && (
        <div role="status" className="text-sm">
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
          {!error && message && <span className="text-green-700 dark:text-green-400">{message}</span>}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4 max-w-md">
        <div>
          <ItemHeader control={control("photo")}>
            <span id="profile-photo" className="text-sm font-medium text-slate-900 dark:text-slate-100">Photo</span>
            <span className="block text-xs text-slate-600 dark:text-slate-400">The picture shown next to your name.</span>
          </ItemHeader>
          <ProfilePhoto photo={data.photo} level={level("photo")} webOpen={web.available} onChanged={reloadPhoto} />
        </div>
        <div data-tour="profile-bio">
          <ItemHeader control={control("bio")}>
            <div className="flex items-baseline justify-between">
              <label htmlFor="profile-bio" className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Bio
              </label>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {bioInput.trim().length}/{MAX_BIO_LENGTH}
              </span>
            </div>
          </ItemHeader>
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
          {page?.available && (
            <div className="mt-2">
              <SeparatePublicBio
                saved={page.publicBio}
                publicNameAliasId={page.publicNameAliasId}
                onChanged={async (text) => {
                  setError(null);
                  setMessage(text);
                  await loadPage();
                }}
              />
            </div>
          )}
        </div>
        <div>
          <ItemHeader control={control("ask_me_about")}>
            <label htmlFor="profile-ask-me-about" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              Ask me about…
            </label>
          </ItemHeader>
          <TagInput
            id="profile-ask-me-about"
            tags={topics}
            onChange={setTopics}
            placeholder="e.g. cozy mysteries, querying agents, worldbuilding"
            maxTags={MAX_TOPICS}
            maxTagLength={MAX_TOPIC_LENGTH}
          />
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Topics you&apos;re happy to chat about. Press Enter or comma after each one.
          </p>
        </div>
        {/* Instagram — written to Kajabi's "Instagram Handle" contact custom field. */}
        <div>
          <ItemHeader control={control("instagram")}>
            <label htmlFor="profile-instagram" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              Instagram
            </label>
          </ItemHeader>
          {data.kajabiLinked ? (
            <>
              <input
                id="profile-instagram"
                type="text"
                value={instagramInput}
                onChange={(e) => setInstagramInput(e.target.value)}
                placeholder="instagram.com/yourname"
                maxLength={300}
                autoComplete="off"
                className={INPUT_CLASS}
              />
              <ClearHint value={instagramInput} noun="Instagram" onClear={() => setInstagramInput("")} />
            </>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Instagram isn&apos;t set up for your account yet. Email{" "}
              <a data-track="settings-profile-contact-support" href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                {SUPPORT_EMAIL}
              </a>{" "}
              and we&apos;ll sort it out.
            </p>
          )}
        </div>
        <div>
          <ItemHeader control={control("facebook")}>
            <label htmlFor="profile-facebook" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              Facebook
            </label>
          </ItemHeader>
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
          <ItemHeader control={control("x")}>
            <label htmlFor="profile-x" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              X / Twitter
            </label>
          </ItemHeader>
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
        <button type="submit" data-track="settings-profile-save" disabled={saving} className={SAVE_CLASS}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      {page?.available && (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
          <WriterProfilePanel settings={page} onChanged={loadPage} onTurnedOn={() => setJustTurnedOn(true)} onTurnedOff={() => setJustTurnedOn(false)} />
          {justTurnedOn && page.isPublic && (
            <div className="mt-4">
              <WriterProfileOnNote address={page.pageUrl} previewPath={page.previewPath} onDone={() => setJustTurnedOn(false)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

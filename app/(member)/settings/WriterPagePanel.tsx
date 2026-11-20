"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import ConfirmDialog from "@/components/ConfirmDialog";
import { WRITER_PROFILES } from "@/lib/config";
import { BIO_MAX_LENGTH, validateHandle } from "@/lib/writer-profile";
import {
  claimWriterHandle,
  getWriterPageSettings,
  loadHandleStatus,
  saveWriterPageDetails,
  setWriterPageSwitch,
  type HandleStatus,
  type WriterPageSettings,
} from "./writerPageActions";

const INPUT_CLASS = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const SAVE_CLASS = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const LINK_CLASS = "underline text-plum-700 dark:text-plum-300";

/** How long to wait after the last keystroke before asking whether the address is free. */
const CHECK_DELAY_MS = 400;

/**
 * Settings > Profile > "Your page on the web": the member's public writer page (docs/WRITER_PROFILES.md). Off until they
 * switch it on. Turning it off and moving it to a new address ask first (`.claude/rules/confirmations.md`). The address
 * shown is whatever the server stored; availability is asked as they type and always checked again when they save.
 */
export function WriterPagePanel() {
  const [data, setData] = useState<WriterPageSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [aliasId, setAliasId] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"off" | "address" | null>(null);

  const load = useCallback(async () => {
    const result = await getWriterPageSettings();
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setData(result);
    setHandleInput(result.handle ?? result.suggestedHandle);
    setAliasId(result.publicNameAliasId);
    setShowPhoto(result.showPhoto);
    setBio(result.bio);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The live check. What cannot be a handle is said at once, here; only an address that could be one is asked of the server, after
  // a pause. Nothing is asked for what is already theirs. A saved answer is for the address it was asked about.
  const typed = handleInput.trim();
  const local = data && typed && typed.toLowerCase() !== data.handle ? validateHandle(typed) : null;
  const askAbout = local?.ok ? local.handle : null;
  const [remote, setRemote] = useState<{ handle: string; status: HandleStatus } | null>(null);
  useEffect(() => {
    if (!askAbout) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await loadHandleStatus(askAbout);
      if (current && !("error" in result)) setRemote({ handle: askAbout, status: result });
    }, CHECK_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [askAbout]);
  const handleStatus: HandleStatus | null = !local ? null : !local.ok ? { status: "invalid", message: local.message } : remote?.handle === local.handle ? remote.status : null;

  async function saveHandle() {
    setError(null);
    setMessage(null);
    setBusy(true);
    const result = await claimWriterHandle(handleInput);
    setBusy(false);
    if ("error" in result) return result.error;
    setMessage(result.changed ? "Address changed. The old one sends visitors to the new one." : "Address saved. Your page is still off: switch it on when you are ready.");
    await load();
    return null;
  }

  function handleSubmitHandle(e: FormEvent) {
    e.preventDefault();
    if (data?.hasPage && data.handle !== handleInput.trim().toLowerCase()) return setConfirm("address");
    void saveHandle().then((problem) => problem && setError(problem));
  }

  async function switchPage(isPublic: boolean) {
    setError(null);
    setMessage(null);
    setBusy(true);
    const result = await setWriterPageSwitch(isPublic);
    setBusy(false);
    if ("error" in result) return result.error;
    setMessage(isPublic ? "Your page is on. Anyone can open it." : "Your page is off. It is no longer public.");
    await load();
    return null;
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const result = await saveWriterPageDetails({ publicNameAliasId: aliasId, showPhoto, bio });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setMessage("Saved.");
    await load();
  }

  if (!data) {
    return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null;
  }
  // The `writer_pages` flag is off for them: no section at all (docs/WRITER_PROFILES.md, "The feature flag").
  if (!data.available) return null;

  const addressChanged = data.handle !== handleInput.trim().toLowerCase();
  const canSaveAddress = !busy && handleInput.trim() !== "" && addressChanged && (handleStatus === null || handleStatus.status === "available");
  const shownName = data.nameChoices.find((c) => c.aliasId === aliasId)?.label ?? data.nameChoices[0]?.label ?? "";

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h2 id="profile-writer-page" className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-1">
          Your page on the web
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Turn this on and you get a page of your own that anyone can open without signing in, and that search engines such as
          Google can list. It shows the name you choose below, your photo if you tick it, and the bio you write. It shows nothing
          else from the Hub: not your email, your writing or your prickles. It stays off until you switch it on.
        </p>
      </div>

      {(error || message) && (
        <div role="status" className="text-sm">
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
          {!error && message && <span className="text-green-600 dark:text-green-400">{message}</span>}
        </div>
      )}

      <form onSubmit={handleSubmitHandle} className="space-y-1">
        <label htmlFor="writer-page-handle" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
          Your address
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{data.addressPrefix}</span>
          <input
            id="writer-page-handle"
            type="text"
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            maxLength={WRITER_PROFILES.handleMaxLength + 10}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="ada-example"
            className={INPUT_CLASS}
          />
        </div>
        <p role="status" className="min-h-4 text-xs text-slate-600 dark:text-slate-400">
          {handleStatus?.status === "available" && <span className="text-green-700 dark:text-green-400">That address is free.</span>}
          {handleStatus && "message" in handleStatus && <span className="text-red-600 dark:text-red-400">{handleStatus.message}</span>}
          {!handleStatus && !data.hasPage && "Lowercase letters, numbers and single hyphens, with no spaces."}
        </p>
        <button type="submit" data-track="settings-writer-page-address" disabled={!canSaveAddress} className={SAVE_CLASS}>
          {data.hasPage ? "Change address" : "Save address"}
        </button>
      </form>

      {data.hasPage && (
        <>
          <form onSubmit={saveDetails} className="space-y-4">
            <div>
              <label htmlFor="writer-page-name" className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                Name shown
              </label>
              <select
                id="writer-page-name"
                value={aliasId ?? ""}
                onChange={(e) => setAliasId(e.target.value || null)}
                data-track="settings-writer-page-name"
                className={INPUT_CLASS}
              >
                {data.nameChoices.map((choice) => (
                  <option key={choice.aliasId ?? "display"} value={choice.aliasId ?? ""}>
                    {choice.label}
                    {choice.aliasId === null ? " (your display name)" : " (pen name)"}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Your page would be headed &ldquo;{shownName}&rdquo;. Take a moment to check it is the name you want on the open web.
                {data.usingAccountName && (
                  <>
                    {" "}
                    You have not chosen a display name, so this is the name on your account. You can set one under Identity.
                  </>
                )}{" "}
                Pen names you have marked &ldquo;Show on my writer page&rdquo; under Identity appear here.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showPhoto}
                disabled={!data.photoAvailable}
                onChange={(e) => setShowPhoto(e.target.checked)}
                data-track="settings-writer-page-photo"
                className="mt-0.5 rounded"
              />
              <span>
                Show my photo
                <span className="block text-xs text-slate-600 dark:text-slate-400">
                  {data.photoAvailable
                    ? "The photo you have in the Hub. Anyone who opens your page can see it."
                    : "There is no photo that can be shown on a public page yet. A Gravatar picture is never published, because its address carries a code made from your email."}
                </span>
              </span>
            </label>

            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label htmlFor="writer-page-bio" className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Bio
                </label>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {bio.trim().length}/{BIO_MAX_LENGTH}
                </span>
              </div>
              <textarea
                id="writer-page-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                maxLength={BIO_MAX_LENGTH + 100}
                placeholder="A little about you and your writing. Plain text."
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">This bio is separate from the one on your member profile. Only what you write here goes on the page.</p>
            </div>

            <button type="submit" data-track="settings-writer-page-save" disabled={busy} className={SAVE_CLASS}>
              Save page details
            </button>
          </form>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-2">
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={data.isPublic}
                disabled={busy}
                onChange={(e) => (e.target.checked ? void switchPage(true).then((p) => p && setError(p)) : setConfirm("off"))}
                data-track="settings-writer-page-switch"
                className="mt-0.5 rounded"
              />
              <span>
                Show my page on the web
                <span className="block text-xs text-slate-600 dark:text-slate-400">
                  {data.isPublic ? "Your page is on: anyone can open it and search engines can list it." : "Your page is off: only you can see it, as a preview."}
                </span>
              </span>
            </label>
            <p className="text-sm">
              <Link href={data.previewPath} target="_blank" data-track="settings-writer-page-preview" className={LINK_CLASS}>
                View as a visitor
              </Link>
              <span className="text-xs text-slate-600 dark:text-slate-400"> (opens a preview that only you can see)</span>
              {data.isPublic && data.pageUrl && (
                <>
                  {" · "}
                  <a href={data.pageUrl} target="_blank" rel="noreferrer" data-track="settings-writer-page-open" className={LINK_CLASS}>
                    Open your page
                  </a>
                </>
              )}
            </p>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm === "off"}
        onClose={() => setConfirm(null)}
        title="Turn off your page?"
        body="Your page stops being public at once, and the address shows a page that was not found. Search engines drop it over time. Your address stays yours, and you can switch it back on whenever you like."
        confirmLabel="Turn off page"
        onConfirm={async () => (await switchPage(false)) ?? undefined}
      />
      <ConfirmDialog
        open={confirm === "address"}
        onClose={() => setConfirm(null)}
        title="Change your page address?"
        body={`Anyone who opens your old address is sent to the new one, and no one else can take the old address for ${WRITER_PROFILES.handleReservationDays} days. Links you have already shared keep working. Links to the new address will be the ones to share from now on.`}
        confirmLabel="Change address"
        onConfirm={async () => (await saveHandle()) ?? undefined}
      />
    </div>
  );
}

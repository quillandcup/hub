"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import ConfirmDialog from "@/components/ConfirmDialog";
import { WRITER_PROFILES } from "@/lib/config";
import { validateHandle } from "@/lib/writer-profile";
import {
  claimWriterHandle,
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
 * Settings > Profile > "Your writer page on the web": the switch, the address and the name of the member's public page
 * (docs/product/WRITER_PROFILES.md). What the page shows (the bio, photo and social links) is chosen item by item above, with the
 * lock, house and globe on each; this block only holds what is about the page itself. It asks for the address first and
 * then the name, because the page cannot go on without both, and it stays off until they switch it on. Turning it off and
 * moving it to a new address ask first (`.claude/rules/confirmations.md`). The settings are the parent's (they are also what
 * decides whether a globe is shown); `onChanged` asks it to reload them after a change.
 */
export function WriterPagePanel({ settings: data, onChanged }: { settings: WriterPageSettings; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState(data.handle ?? data.suggestedHandle);
  const [aliasId, setAliasId] = useState<string | null>(data.publicNameAliasId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"off" | "address" | null>(null);

  // A reload that changes what is saved (the address after a save, the name after a save) starts the inputs from it again.
  const savedHandle = data.handle;
  const savedAlias = data.publicNameAliasId;
  useEffect(() => {
    if (savedHandle) setHandleInput(savedHandle);
  }, [savedHandle]);
  useEffect(() => {
    setAliasId(savedAlias);
  }, [savedAlias]);

  // The live check. What cannot be a handle is said at once, here; only an address that could be one is asked of the server, after
  // a pause. Nothing is asked for what is already theirs. A saved answer is for the address it was asked about.
  const typed = handleInput.trim();
  const local = typed && typed.toLowerCase() !== data.handle ? validateHandle(typed) : null;
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
    setMessage(result.changed ? "Address changed. The old one sends visitors to the new one." : "Address saved. Next, choose the name for your page.");
    await onChanged();
    return null;
  }

  function handleSubmitHandle(e: FormEvent) {
    e.preventDefault();
    if (data.hasPage && data.handle !== handleInput.trim().toLowerCase()) return setConfirm("address");
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
    await onChanged();
    return null;
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const result = await saveWriterPageDetails({ publicNameAliasId: aliasId, bio: data.publicBio });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setMessage("Name saved.");
    await onChanged();
  }

  const addressChanged = data.handle !== handleInput.trim().toLowerCase();
  const canSaveAddress = !busy && handleInput.trim() !== "" && addressChanged && (handleStatus === null || handleStatus.status === "available");
  const shownName = data.nameChoices.find((c) => c.aliasId === aliasId)?.label ?? null;
  const nameChanged = aliasId !== data.publicNameAliasId || !data.nameChosen;
  const canSwitchOn = data.hasPage && data.nameChosen;

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h2 id="profile-writer-page" className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-1">
          Your writer page on the web
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Turn this on and you get a page of your own that anyone can open without signing in, and that search engines such as
          Google can list. It always shows the name you choose below. Everything else on it is what you have opened to the
          internet with the globe, in the profile above. It shows nothing else from the Hub: not your email, your writing or
          your prickles. It stays off until you switch it on.
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
          {!handleStatus && !data.hasPage && (
            <>
              {data.suggestedHandle ? "We made this one from your display name. " : ""}
              Lowercase letters, numbers and single hyphens, with no spaces.
            </>
          )}
        </p>
        <button type="submit" data-track="settings-writer-page-address" disabled={!canSaveAddress} className={SAVE_CLASS}>
          {data.hasPage ? "Change address" : "Save address"}
        </button>
      </form>

      {data.hasPage && (
        <form onSubmit={saveName} className="space-y-1">
          <label htmlFor="writer-page-name" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
            Name shown
          </label>
          <select
            id="writer-page-name"
            value={aliasId ?? ""}
            onChange={(e) => setAliasId(e.target.value || null)}
            data-track="settings-writer-page-name"
            className={INPUT_CLASS}
          >
            {!data.nameChosen && aliasId === null && (
              <option value="" disabled>
                Choose a name…
              </option>
            )}
            {data.nameChoices.map((choice) => (
              <option key={choice.aliasId ?? "display"} value={choice.aliasId ?? ""}>
                {choice.label}
                {choice.aliasId === null ? " (your display name)" : " (pen name)"}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {data.nameChoices.length === 0
              ? "You have not chosen a display name, and the page never uses the name on your account unless you pick it. Set a display name under Identity, or mark a pen name there as “Show on my writer page”, then come back."
              : shownName
                ? `Your page would be headed “${shownName}”. Take a moment to check it is the name you want on the open web.`
                : "Choose the name that heads your page. It is the one thing the page always shows."}{" "}
            Pen names you have marked &ldquo;Show on my writer page&rdquo; under Identity appear here.
          </p>
          <button type="submit" data-track="settings-writer-page-save-name" disabled={busy || !nameChanged || (aliasId === null && !data.nameChoices.some((c) => c.aliasId === null))} className={SAVE_CLASS}>
            Save name
          </button>
        </form>
      )}

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
              {data.isPublic
                ? "Your page is on: anyone can open it and search engines can list it."
                : canSwitchOn
                  ? "Your page is off: only you can see it, as a preview."
                  : data.hasPage
                    ? "Choose the name for your page first. Until then it stays off."
                    : "Choose your address first. Until then it stays off."}
            </span>
          </span>
        </label>
        {data.hasPage && (
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
        )}
      </div>

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

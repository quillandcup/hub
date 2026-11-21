"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import ConfirmDialog from "@/components/ConfirmDialog";
import { WRITER_PROFILES } from "@/lib/config";
import { validateHandle } from "@/lib/writer-profile";
import {
  addProfilePenName,
  claimWriterHandle,
  loadHandleStatus,
  saveWriterProfileDetails,
  setWriterProfileSwitch,
  type HandleStatus,
  type MyWriterProfile,
} from "./writerProfileActions";

const INPUT_CLASS = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const SAVE_CLASS = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const LINK_CLASS = "underline text-plum-700 dark:text-plum-300";

/** How long to wait after the last keystroke before asking whether the address is free. */
const CHECK_DELAY_MS = 400;

/**
 * Settings > Profile > "Your writer profile on the web": the switch, the address and the name of the member's public page
 * (docs/product/WRITER_PROFILES.md). What the page shows (the bio, photo and social links) is chosen item by item above, with the
 * lock, house and globe on each; this block only holds what is about the page itself. It asks for the address first and
 * then the name, because the page cannot go on without both, and it stays off until they switch it on. Turning it off and
 * moving it to a new address ask first (`.claude/rules/confirmations.md`). The settings are the parent's (they are also what
 * decides whether a globe is shown); `onChanged` asks it to reload them after a change.
 */
export function WriterProfilePanel({
  settings: data,
  onChanged,
  onTurnedOn,
  onTurnedOff,
}: {
  settings: MyWriterProfile;
  onChanged: () => Promise<void>;
  /** Called once the page has been switched on, so the parent can show who sees what. */
  onTurnedOn?: () => void;
  onTurnedOff?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState(data.handle ?? data.suggestedHandle);
  // What the name list shows as chosen: a pen name's id, "account", "display" (the display name), or "" when nothing is chosen yet.
  const savedChoice = data.publicNameAliasId ?? (data.useAccountName ? "account" : data.nameChoices.some((c) => c.kind === "display") ? "display" : "");
  const [choice, setChoice] = useState(savedChoice);
  const [penName, setPenName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"off" | "address" | null>(null);

  // A reload that changes what is saved (the address after a save, the name after a save) starts the inputs from it again.
  const savedHandle = data.handle;
  useEffect(() => {
    if (savedHandle) setHandleInput(savedHandle);
  }, [savedHandle]);
  useEffect(() => {
    setChoice(savedChoice);
  }, [savedChoice]);

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
    setMessage(result.changed ? "Address changed. The old one sends visitors to the new one." : "Address saved. Next, choose the name for your profile.");
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
    const result = await setWriterProfileSwitch(isPublic);
    setBusy(false);
    if ("error" in result) return result.error;
    setMessage(isPublic ? "Your profile is on. Anyone can open it." : "Your profile is off. It is no longer public.");
    await onChanged();
    if (isPublic) onTurnedOn?.();
    else onTurnedOff?.();
    return null;
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const result = await saveWriterProfileDetails({
      publicNameAliasId: penNameChosen ? choice : null,
      useAccountName: choice === "account",
      bio: data.publicBio,
    });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setMessage("Name saved.");
    await onChanged();
  }

  async function addPenName(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const result = await addProfilePenName(penName);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setPenName("");
    setMessage("Pen name added. Choose “Save name” to show it on your profile.");
    await onChanged();
    setChoice(result.aliasId);
  }

  const addressChanged = data.handle !== handleInput.trim().toLowerCase();
  const canSaveAddress = !busy && handleInput.trim() !== "" && addressChanged && (handleStatus === null || handleStatus.status === "available");
  const optionValue = (c: MyWriterProfile["nameChoices"][number]) => (c.kind === "alias" ? (c.aliasId as string) : c.kind);
  const chosen = data.nameChoices.find((c) => optionValue(c) === choice) ?? null;
  const penNameChosen = chosen?.kind === "alias";
  const shownName = chosen?.label ?? null;
  const nameChanged = choice !== savedChoice;
  const canSwitchOn = data.hasPage && data.nameChosen;

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h2 id="profile-writer-profile" className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-1">
          Your writer profile on the web
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Turn this on and you get a profile page of your own that anyone can open without signing in, and that search engines such as
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
        <label htmlFor="writer-profile-handle" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
          Your address
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{data.addressPrefix}</span>
          <input
            id="writer-profile-handle"
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
        <button type="submit" data-track="settings-writer-profile-address" disabled={!canSaveAddress} className={SAVE_CLASS}>
          {data.hasPage ? "Change address" : "Save address"}
        </button>
      </form>

      {data.hasPage && (
        <form onSubmit={saveName} className="space-y-1">
          <label htmlFor="writer-profile-name" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
            Name shown
          </label>
          <select
            id="writer-profile-name"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            data-track="settings-writer-profile-name"
            className={INPUT_CLASS}
          >
            {choice === "" && (
              <option value="" disabled>
                Choose a name…
              </option>
            )}
            {data.nameChoices.map((c) => (
              <option key={optionValue(c)} value={optionValue(c)}>
                {c.label}
                {c.kind === "display" ? " (your display name)" : c.kind === "alias" ? " (pen name)" : " (the name on your account)"}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {shownName
              ? `Your profile would be headed “${shownName}”. Check that it is the name you want on the open web.`
              : "Choose the name that heads your profile. It is the one thing your profile always shows, and the name on your account is only used if you pick it here."}
          </p>
          <button type="submit" data-track="settings-writer-profile-save-name" disabled={busy || !nameChanged || choice === ""} className={SAVE_CLASS}>
            Save name
          </button>
        </form>
      )}

      {data.hasPage && (
        <form onSubmit={addPenName} className="space-y-1">
          <label htmlFor="writer-profile-pen-name" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
            Add a pen name
          </label>
          <div className="flex items-center gap-2">
            <input
              id="writer-profile-pen-name"
              type="text"
              value={penName}
              onChange={(e) => setPenName(e.target.value)}
              maxLength={200}
              autoComplete="off"
              placeholder="The name you write under"
              className={INPUT_CLASS}
            />
            <button type="submit" data-track="settings-writer-profile-add-pen-name" disabled={busy || penName.trim() === ""} className={SAVE_CLASS}>
              Add pen name
            </button>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            It joins your names under Identity, and then it is in the list above for you to choose.
          </p>
        </form>
      )}

      <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-2">
        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={data.isPublic}
            disabled={busy}
            onChange={(e) => (e.target.checked ? void switchPage(true).then((p) => p && setError(p)) : setConfirm("off"))}
            data-track="settings-writer-profile-switch"
            className="mt-0.5 rounded"
          />
          <span>
            Show my profile on the web
            <span className="block text-xs text-slate-600 dark:text-slate-400">
              {data.isPublic
                ? "Your profile is on: anyone can open it and search engines can list it."
                : canSwitchOn
                  ? "Your profile is off: only you can see it, as a preview."
                  : data.hasPage
                    ? "Choose the name your profile shows first. Until then it stays off."
                    : "Choose your address first. Until then it stays off."}
            </span>
          </span>
        </label>
        {data.hasPage && (
          <p className="text-sm">
            <Link href={data.previewPath} target="_blank" data-track="settings-writer-profile-preview" className={LINK_CLASS}>
              View as a visitor
            </Link>
            <span className="text-xs text-slate-600 dark:text-slate-400"> (opens a preview that only you can see)</span>
            {data.isPublic && data.pageUrl && (
              <>
                {" · "}
                <a href={data.pageUrl} target="_blank" rel="noreferrer" data-track="settings-writer-profile-open" className={LINK_CLASS}>
                  Open your profile
                </a>
              </>
            )}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirm === "off"}
        onClose={() => setConfirm(null)}
        title="Turn off your profile?"
        body="Your profile stops being public at once, and its address shows a page that was not found. Search engines drop it over time. Your address stays yours, and you can switch it back on whenever you like."
        confirmLabel="Turn off profile"
        onConfirm={async () => (await switchPage(false)) ?? undefined}
      />
      <ConfirmDialog
        open={confirm === "address"}
        onClose={() => setConfirm(null)}
        title="Change your profile address?"
        body={`Anyone who opens your old address is sent to the new one, and no one else can take the old address for ${WRITER_PROFILES.handleReservationDays} days. Links you have already shared keep working. Links to the new address will be the ones to share from now on.`}
        confirmLabel="Change address"
        onConfirm={async () => (await saveHandle()) ?? undefined}
      />
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import {
  getIdentitySettings,
  updateRealName,
  updateBirthday,
  setDisplayName,
  setCustomDisplayName,
  addNameAlias,
  addEmailAlias,
  type IdentitySettings,
} from "./identityActions";
import { SUPPORT_EMAIL } from "@/lib/config";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WRITE_OWN = "__write_own__";
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function sourceLabel(source: string): string {
  switch (source) {
    case "member":
      return "you added this";
    case "zoom":
      return "from Zoom";
    case "slack":
      return "from Slack";
    case "auto_detected":
      return "detected automatically";
    case "manual":
      return "you added this";
    default:
      return source;
  }
}

function AliasChip({
  label,
  source,
  active,
  isDisplayName,
}: {
  label: string;
  isDisplayName?: boolean;
  source: string;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
        active
          ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          : "border-dashed border-slate-300 dark:border-slate-700 bg-transparent opacity-60"
      }`}
    >
      <div className="min-w-0">
        <span className={`truncate ${active ? "text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-400 line-through"}`}>
          {label}
        </span>
        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{sourceLabel(source)}</span>
        {isDisplayName && (
          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-plum-100 dark:bg-plum-900/40 text-plum-700 dark:text-plum-300">
            Your display name
          </span>
        )}
      </div>
    </div>
  );
}

export function IdentityPanel() {
  const [data, setData] = useState<IdentitySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [birthdayMonth, setBirthdayMonth] = useState<string>("");
  const [birthdayDay, setBirthdayDay] = useState<string>("");
  const [savingBirthday, setSavingBirthday] = useState(false);
  const [nameAliasInput, setNameAliasInput] = useState("");
  const [addingNameAlias, setAddingNameAlias] = useState(false);
  const [emailAliasInput, setEmailAliasInput] = useState("");
  const [addingEmailAlias, setAddingEmailAlias] = useState(false);
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [customDisplayName, setCustomDisplayNameInput] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getIdentitySettings();
    if ("error" in result) {
      setError(result.error);
      setData(null);
    } else {
      setData(result);
      setNameInput(result.realName);
      setBirthdayMonth(result.birthdayMonth ? String(result.birthdayMonth) : "");
      setBirthdayDay(result.birthdayDay ? String(result.birthdayDay) : "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    if (!data || nameInput.trim() === data.realName) return;
    setSavingName(true);
    setError(null);
    setMessage(null);
    const result = await updateRealName(nameInput);
    if ("error" in result) {
      setError(result.error);
    } else {
      setMessage("Name updated.");
      await load();
    }
    setSavingName(false);
  }

  async function handleDisplayNameChange(value: string) {
    if (value === WRITE_OWN) {
      setCustomDisplayNameInput("");
      return;
    }
    setCustomDisplayNameInput(null);
    setSavingDisplayName(true);
    setError(null);
    setMessage(null);
    const result = await setDisplayName(value === "" ? null : value);
    if ("error" in result) {
      setError(result.error);
    } else {
      setMessage("Display name updated.");
      await load();
    }
    setSavingDisplayName(false);
  }

  async function handleSaveCustomDisplayName(e: FormEvent) {
    e.preventDefault();
    if (!customDisplayName?.trim()) return;
    setSavingDisplayName(true);
    setError(null);
    setMessage(null);
    const result = await setCustomDisplayName(customDisplayName);
    if ("error" in result) {
      setError(result.error);
    } else {
      setCustomDisplayNameInput(null);
      setMessage("Display name updated.");
      await load();
    }
    setSavingDisplayName(false);
  }

  async function handleSaveBirthday(e: FormEvent) {
    e.preventDefault();
    setSavingBirthday(true);
    setError(null);
    setMessage(null);
    const month = birthdayMonth ? Number(birthdayMonth) : null;
    const day = birthdayDay ? Number(birthdayDay) : null;
    const result = await updateBirthday(month, day);
    if ("error" in result) {
      setError(result.error);
    } else {
      setMessage("Birthday updated.");
      await load();
    }
    setSavingBirthday(false);
  }

  async function handleAddNameAlias(e: FormEvent) {
    e.preventDefault();
    if (!nameAliasInput.trim()) return;
    setAddingNameAlias(true);
    setError(null);
    setMessage(null);
    const result = await addNameAlias(nameAliasInput);
    if ("error" in result) {
      setError(result.error);
    } else {
      setNameAliasInput("");
      setMessage("Name added. It may take a few minutes to apply to recent attendance.");
      await load();
    }
    setAddingNameAlias(false);
  }

  async function handleAddEmailAlias(e: FormEvent) {
    e.preventDefault();
    if (!emailAliasInput.trim()) return;
    setAddingEmailAlias(true);
    setError(null);
    setMessage(null);
    const result = await addEmailAlias(emailAliasInput);
    if ("error" in result) {
      setError(result.error);
    } else {
      setEmailAliasInput("");
      setMessage("Email added.");
      await load();
    }
    setAddingEmailAlias(false);
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-md" />
        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-md" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Couldn't load your identity settings."}</p>;
  }

  return (
    <div className="space-y-8">
      {(error || message) && (
        <div role="status" className="text-sm">
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
          {!error && message && <span className="text-green-600 dark:text-green-400">{message}</span>}
        </div>
      )}

      {/* Real Name, then Display Name, then the rest, most important first. Each block is a Getting started stop. */}
      {/* Real Name */}
      <div data-tour="identity-basics">
        <h3 id="identity-real-name" className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Real Name</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          Your Real Name: the one on your account and records. Not necessarily what other members see; that's your Display Name, below.
        </p>
        {data.nameChangeLocked ? (
          <div className="max-w-md">
            <p className="px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-md bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100">
              {data.realName}
            </p>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              You&apos;ve already changed your name once. Email{" "}
              <a data-track="settings-identity-contact-support" href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                {SUPPORT_EMAIL}
              </a>{" "}
              if it needs to change again.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSaveName} className="flex gap-2 max-w-md">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
              maxLength={200}
            />
            <button
              type="submit"
              data-track="settings-identity-save-name"
              disabled={savingName || nameInput.trim() === data.realName || !nameInput.trim()}
              className="px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingName ? "Saving…" : "Save"}
            </button>
          </form>
        )}
      </div>

      {/* Display Name: what the community sees. */}
      <div data-tour="identity-display-name">
        <h3 id="identity-display-name" className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Display Name</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          The name other members see everywhere, as opposed to your Real Name, which stays on
          your account and records. Choose your Real Name, one of your pen names below, or write your own.
        </p>
        <select
          value={customDisplayName !== null ? WRITE_OWN : (data.displayName ?? "")}
          data-track="settings-identity-display-name"
          onChange={(e) => handleDisplayNameChange(e.target.value)}
          disabled={savingDisplayName}
          className="w-full max-w-md px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm disabled:opacity-50"
        >
          <option value="">{data.realName} (Real Name)</option>
          {data.nameAliases
            .filter((a) => a.active && a.alias !== data.realName)
            .map((a) => (
              <option key={a.id} value={a.alias}>
                {a.alias}
              </option>
            ))}
          <option value={WRITE_OWN}>Write your own…</option>
        </select>
        {customDisplayName !== null && (
          <form onSubmit={handleSaveCustomDisplayName} className="flex gap-2 max-w-md mt-2">
            <input
              type="text"
              value={customDisplayName}
              onChange={(e) => setCustomDisplayNameInput(e.target.value)}
              placeholder="e.g. River Wilde"
              aria-label="Your own display name"
              className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
              maxLength={200}
            />
            <button
              type="submit"
              data-track="settings-identity-save-display-name"
              disabled={savingDisplayName || !customDisplayName.trim()}
              className="px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingDisplayName ? "Saving…" : "Save"}
            </button>
          </form>
        )}
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          A name you write here is also saved as a pen name, so it matches your Zoom and Slack attendance.
        </p>
      </div>

      {/* Pen Names / Zoom & Slack aliases */}
      <div data-tour="identity-names">
        <h3 id="identity-pen-names" className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Pen Names &amp; Zoom/Slack Names</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          Your prickle attendance is counted by the name Zoom shows for you. The simplest fix is to change your
          name in Zoom to match your Real Name above. If you&apos;d rather join as something else, such as a pen
          name or a nickname, add that name here (exactly as Zoom shows it) so your attendance still counts. These
          only match your attendance; they don&apos;t change the name shown in the community. Once added, you can
          choose one as your Display Name above.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {data.nameAliases.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No other names on file yet.</p>
          )}
          {data.nameAliases.map((alias) => (
            <AliasChip
              key={alias.id}
              label={alias.alias}
              source={alias.source}
              active={alias.active}
              isDisplayName={alias.alias === data.displayName}
            />
          ))}
        </div>
        <form onSubmit={handleAddNameAlias} className="flex gap-2 max-w-md">
          <input
            type="text"
            value={nameAliasInput}
            onChange={(e) => setNameAliasInput(e.target.value)}
            placeholder="e.g. River Wilde"
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            maxLength={200}
          />
          <button
            type="submit"
            data-track="settings-identity-add-name-alias"
            disabled={addingNameAlias || !nameAliasInput.trim()}
            className="px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addingNameAlias ? "Adding…" : "Add"}
          </button>
        </form>
      </div>

      {/* Email aliases */}
      <div data-tour="identity-emails">
        <h3 id="identity-email-aliases" className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Email Aliases</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          Other email addresses that should also count as you (e.g. an old Kajabi or Slack email). Your
          primary email is <span className="font-medium">{data.primaryEmail}</span>.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {data.emailAliases.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No email aliases on file yet.</p>
          )}
          {data.emailAliases.map((alias) => (
            <AliasChip
              key={alias.id}
              label={alias.aliasEmail}
              source={alias.source}
              active={alias.active}
            />
          ))}
        </div>
        <form onSubmit={handleAddEmailAlias} className="flex gap-2 max-w-md">
          <input
            type="email"
            value={emailAliasInput}
            onChange={(e) => setEmailAliasInput(e.target.value)}
            placeholder="old-email@example.com"
            className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
          />
          <button
            type="submit"
            data-track="settings-identity-add-email-alias"
            disabled={addingEmailAlias || !emailAliasInput.trim()}
            className="px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addingEmailAlias ? "Adding…" : "Add"}
          </button>
        </form>
      </div>

      {/* Birthday */}
      <div data-tour="identity-birthday">
        <h3 id="identity-birthday" className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">Birthday</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          Month and day only — no year needed. Used to celebrate your hedgie birthday with you.
        </p>
        <form onSubmit={handleSaveBirthday} className="flex gap-2 max-w-md">
          <select data-track="settings-identity-birthday-month"
            value={birthdayMonth}
            onChange={(e) => {
              setBirthdayMonth(e.target.value);
              setBirthdayDay("");
            }}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
          >
            <option value="">Month</option>
            {MONTHS.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
          <select data-track="settings-identity-birthday-day"
            value={birthdayDay}
            onChange={(e) => setBirthdayDay(e.target.value)}
            disabled={!birthdayMonth}
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm disabled:opacity-50"
          >
            <option value="">Day</option>
            {Array.from(
              { length: birthdayMonth ? DAYS_IN_MONTH[Number(birthdayMonth) - 1] : 31 },
              (_, i) => i + 1
            ).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="submit"
            data-track="settings-identity-save-birthday"
            disabled={
              savingBirthday ||
              (!!birthdayMonth !== !!birthdayDay) ||
              (Number(birthdayMonth) === (data.birthdayMonth ?? 0) &&
                Number(birthdayDay) === (data.birthdayDay ?? 0))
            }
            className="px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingBirthday ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}

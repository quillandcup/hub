"use client";

import { useEffect, useState } from "react";
import { getRosterSetting, setRosterVisibility } from "./profileActions";

/**
 * Settings > Preferences > "Who's coming": whether other members see you in the list on an upcoming prickle you committed to or
 * added to your calendar. It is a preference about how the Hub treats you, not an item on your profile, so it lives here (it
 * used to sit under Profile). Saved on its own as soon as it is ticked; its confirmation or error shows beside the checkbox.
 */
export function WhosComingSetting() {
  const [show, setShow] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    void getRosterSetting().then((result) => {
      if (!current) return;
      if ("error" in result) setStatus({ error: true, text: result.error });
      else setShow(result.showInRoster);
    });
    return () => {
      current = false;
    };
  }, []);

  async function change(next: boolean) {
    setStatus(null);
    setShow(next);
    setSaving(true);
    const result = await setRosterVisibility(next);
    setSaving(false);
    if ("error" in result) {
      setShow(!next);
      return setStatus({ error: true, text: result.error });
    }
    setStatus({ error: false, text: "Saved." });
  }

  if (show === null) return status ? <p className="text-sm text-red-600 dark:text-red-400">{status.text}</p> : null;

  return (
    <div className="max-w-md">
      <h2 id="profile-whos-coming" className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        Who&apos;s coming
      </h2>
      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={show}
          disabled={saving}
          data-track="settings-profile-show-in-roster"
          onChange={(e) => void change(e.target.checked)}
          className="mt-0.5 rounded"
        />
        <span>
          Show me in &ldquo;Who&apos;s coming&rdquo;
          <span className="block text-xs text-slate-600 dark:text-slate-400">
            On an upcoming prickle&apos;s page, other members see your name if you committed to it or added it to your calendar.
            Untick to stay off those lists; you still see yourself.
          </span>
        </span>
      </label>
      {status && (
        <p role="status" className={`mt-1 ml-6 text-xs ${status.error ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}

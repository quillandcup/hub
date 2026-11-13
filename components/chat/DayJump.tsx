"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu";
import DatePicker from "@/components/DatePicker";
import Modal from "@/components/Modal";
import { track } from "@/lib/analytics/client";
import { chatDayKey } from "@/lib/chat/format";
import { dayStartIso, jumpFrom, jumpHref, type JumpOption } from "@/lib/chat/jump";

const OPTIONS: { option: Exclude<JumpOption, "date">; label: string }[] = [
  { option: "today", label: "Today" },
  { option: "yesterday", label: "Yesterday" },
  { option: "last_week", label: "Last week" },
  { option: "last_month", label: "Last month" },
  { option: "beginning", label: "The very beginning" },
];

/**
 * A day's label in the message list as a button, like Slack's: it opens "Jump to..." (today, yesterday, last
 * week, last month, the very beginning, or a specific date). A jump opens the conversation at the start of the
 * chosen day (`?from=`, in the reader's zone), or at the next day that has messages when that day has none.
 */
export default function DayJump({ channelId, label, timeZone }: { channelId: string; label: string; timeZone: string }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  const go = (option: JumpOption, from: string) => {
    track("chat_jumped", { option });
    router.push(jumpHref(channelId, from));
  };

  const items: ActionMenuItem[] = [
    ...OPTIONS.map(({ option, label: text }) => ({ key: option, label: text, onSelect: () => go(option, jumpFrom(option, new Date(), timeZone)) })),
    { key: "date", label: "Jump to a specific date", separatorBefore: true, onSelect: () => setPicking(true) },
  ];

  return (
    <>
      <ActionMenu
        label={`Jump to... (${label})`}
        heading="Jump to..."
        items={items}
        triggerClassName="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        trigger={
          <>
            {label}
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 8 5 5 5-5" />
            </svg>
          </>
        }
      />
      <Modal isOpen={picking} onClose={() => setPicking(false)} title="Jump to a specific date" maxWidth="sm">
        <DatePicker
          inline
          id={`jump-date-${channelId}`}
          label="Choose a date"
          value=""
          today={chatDayKey(new Date().toISOString(), timeZone)}
          onChange={(day) => {
            setPicking(false);
            go("date", dayStartIso(day, timeZone));
          }}
        />
      </Modal>
    </>
  );
}

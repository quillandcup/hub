"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type TextareaHTMLAttributes } from "react";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import { suggestMentions, type MentionSuggestion } from "@/app/(member)/chat/mention-actions";

const SUGGEST_DELAY_MS = 120;

/** `@Ani` or `#gen` just before the caret (at the start or after a space), with who asked for it and where it starts. */
function triggerBefore(value: string, caret: number): { trigger: "@" | "#"; query: string; start: number } | null {
  const match = /(^|\s)([@#])([^@#<>\n]{0,30})$/.exec(value.slice(0, caret));
  if (!match) return null;
  const start = caret - match[2].length - match[3].length;
  return { trigger: match[2] as "@" | "#", query: match[3], start };
}

/**
 * A message box that offers people (`@`) and channels (`#`) as they are typed, like Slack's. Picking one writes
 * its name into the text (`@Ania Ray`) and remembers what Slack needs for it in `tokens` (shown name to `<@U…>`),
 * which the owner turns the text back into Slack's markup with on send (`fromEditableText`). Arrow keys move
 * through the choices, Enter or Tab picks, Escape closes; while choices are showing those keys are the box's,
 * otherwise `onKeyDown` gets them (send on Enter, cancel on Escape).
 */
export default function MentionTextarea({
  channelId,
  value,
  onValueChange,
  tokens,
  textareaRef,
  onKeyDown,
  ...rest
}: {
  channelId: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Shown name to Slack markup for each person or channel picked; the owner reads it when sending. */
  tokens: MutableRefObject<Map<string, string>>;
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const listId = useId();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState<{ trigger: "@" | "#"; query: string; start: number } | null>(null);
  const [choices, setChoices] = useState<MentionSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const latest = useRef("");
  const pendingCaret = useRef<number | null>(null);

  const setRef = (el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (textareaRef) textareaRef.current = el;
  };

  useEffect(() => {
    if (!open) return;
    const key = `${open.trigger}${open.query}`;
    latest.current = key;
    const timer = setTimeout(async () => {
      const found = await suggestMentions(channelId, open.trigger, open.query).catch(() => []);
      // An answer to something typed since is stale.
      if (latest.current !== key) return;
      setChoices(found);
      setActive(0);
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, channelId]);

  // After a pick the text changes; put the caret behind the inserted name once it has.
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inner.current) {
      inner.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const look = (text: string, caret: number) => {
    const found = triggerBefore(text, caret);
    if (!found) setChoices([]);
    setOpen(found);
  };

  const pick = (choice: MentionSuggestion) => {
    if (!open || !inner.current) return;
    const caret = inner.current.selectionStart ?? value.length;
    // Two people with one name keep their own markup under a told-apart name.
    const base = choice.label;
    let shown = base;
    for (let n = 2; tokens.current.has(shown) && tokens.current.get(shown) !== choice.token; n++) shown = `${base} (${n})`;
    tokens.current.set(shown, choice.token);
    const next = `${value.slice(0, open.start)}${shown} ${value.slice(caret)}`;
    pendingCaret.current = open.start + shown.length + 1;
    onValueChange(next);
    setOpen(null);
    setChoices([]);
  };

  const showing = open !== null && choices.length > 0;

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={setRef}
        value={value}
        aria-autocomplete="list"
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          look(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onClick={(e) => look(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setOpen(null)}
        onKeyDown={(e) => {
          if (showing && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(choices[active]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {showing && open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={open.trigger === "@" ? "People" : "Channels"}
          className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-72 max-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {choices.map((c, i) => (
            <li
              key={c.token}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the box would lose focus (and close the list) before a click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === active ? "bg-plum-50 dark:bg-slate-800" : ""}`}
            >
              {open.trigger === "@" && <MemberAvatar name={c.label.slice(1)} photoUrl={c.photoUrl} size={20} />}
              <span className="truncate">{c.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

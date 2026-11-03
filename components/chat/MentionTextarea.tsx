"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type TextareaHTMLAttributes } from "react";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import { suggestCustomEmoji, suggestMentions, type MentionSuggestion } from "@/app/(member)/chat/mention-actions";
import { Emoji } from "@/components/chat/ChatText";
import { track } from "@/lib/analytics/client";
import { emojiChoices, loadCatalog, type EmojiChoice } from "@/lib/chat/emoji-suggest";

const SUGGEST_DELAY_MS = 120;

type Trigger = "@" | "#" | ":";
type Open = { trigger: Trigger; query: string; start: number };

/**
 * `@Ani`, `#gen` or `:pra` just before the caret (at the start or after a space), with who asked for it and where it
 * starts. An emoji needs two characters after the colon, like Slack, so "10:30" and a lone ":" offer nothing.
 */
function triggerBefore(value: string, caret: number): Open | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)([@#])([^@#<>\n]{0,30})$/.exec(before);
  if (match) return { trigger: match[2] as "@" | "#", query: match[3], start: caret - match[2].length - match[3].length };
  const emoji = /(^|\s):([a-z0-9_+-]{2,30})$/i.exec(before);
  return emoji ? { trigger: ":", query: emoji[2], start: caret - emoji[2].length - 1 } : null;
}

/**
 * A message box that offers people (`@`), channels (`#`) and emoji (`:pray`) as they are typed, like Slack's. Picking one writes
 * its name into the text (`@Ania Ray`) and remembers what Slack needs for it in `tokens` (shown name to `<@U…>`),
 * which the owner turns the text back into Slack's markup with on send (`fromEditableText`). Arrow keys move
 * through the choices, Enter or Tab picks, Escape closes; an emoji is written as its `:shortcode: `, which Slack and the
 * chat both draw; while choices are showing those keys are the box's,
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
  const [open, setOpen] = useState<Open | null>(null);
  const [choices, setChoices] = useState<MentionSuggestion[]>([]);
  const [emoji, setEmoji] = useState<EmojiChoice[]>([]);
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
      if (open.trigger === ":") {
        // Standard emoji are matched here (their data loads on first use); custom ones come from the server.
        const [standard, custom] = await Promise.all([loadCatalog().catch(() => []), suggestCustomEmoji(open.query).catch(() => [])]);
        if (latest.current !== key) return;
        setEmoji(emojiChoices(open.query, standard, custom));
        setActive(0);
        return;
      }
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
    if (!found) {
      setChoices([]);
      setEmoji([]);
    }
    // A different kind of choice must not show the last kind's list while its own is on the way.
    if (found?.trigger !== open?.trigger) {
      setChoices([]);
      setEmoji([]);
    }
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

  const pickEmoji = (choice: EmojiChoice, via: "keyboard" | "pointer") => {
    if (!open || !inner.current) return;
    track("chat_emoji_suggestion_picked", { custom: "url" in choice.emoji, via });
    const caret = inner.current.selectionStart ?? value.length;
    const shown = `:${choice.name}: `;
    pendingCaret.current = open.start + shown.length;
    onValueChange(`${value.slice(0, open.start)}${shown}${value.slice(caret)}`);
    setOpen(null);
    setEmoji([]);
  };

  const count = open?.trigger === ":" ? emoji.length : choices.length;
  const showing = open !== null && count > 0;

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
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              if (open?.trigger === ":") pickEmoji(emoji[active], "keyboard");
              else pick(choices[active]);
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
          aria-label={open.trigger === "@" ? "People" : open.trigger === "#" ? "Channels" : "Emoji"}
          className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-72 max-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {(open.trigger === ":" ? emoji.map((e) => ({ key: e.name, label: `:${e.name}:`, onPick: () => pickEmoji(e, "pointer"), lead: <Emoji name={e.name} custom={{ [e.name]: e.emoji }} /> })) : choices.map((c) => ({ key: c.token, label: c.label, onPick: () => pick(c), lead: open.trigger === "@" ? <MemberAvatar name={c.label.slice(1)} photoUrl={c.photoUrl} size={20} /> : null }))).map((c, i) => (
            <li
              key={c.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the box would lose focus (and close the list) before a click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                c.onPick();
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === active ? "bg-plum-50 dark:bg-slate-800" : ""}`}
            >
              {c.lead}
              <span className="truncate">{c.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

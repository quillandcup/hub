"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type TextareaHTMLAttributes } from "react";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import { suggestCustomEmoji, suggestMentions, type MentionSuggestion } from "@/app/(member)/chat/mention-actions";
import { Emoji } from "@/components/chat/ChatText";
import FormatToolbar from "@/components/chat/FormatToolbar";
import { track } from "@/lib/analytics/client";
import { useComboboxKeys } from "@/lib/hooks/useComboboxKeys";
import { isEmojiOnly } from "@/lib/chat/emoji-only";
import { applyFormat, shortcutFormat, type FormatKind } from "@/lib/chat/format-text";
import { convertEmoticonBefore } from "@/lib/chat/emoticons";
import { applyPastedMentions, pastedNameCandidates } from "@/lib/chat/paste-mentions";
import { emojiChoices, loadCatalog, type EmojiChoice } from "@/lib/chat/emoji-suggest";

const SUGGEST_DELAY_MS = 120;
/** The box grows with its text up to this height, then scrolls. */
export const MAX_BOX_HEIGHT_PX = 240;

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
 * which the owner turns the text back into Slack's markup with on send (`fromEditableText`). The choices' keys
 * (arrows, Enter or Tab, Escape) are the shared `useComboboxKeys`; an emoji is written as the character itself (a custom one as its `:shortcode: `), which
 * Slack and the chat both draw. A toolbar over the box (and Ctrl/Cmd+B, +I, +Shift+X) writes formatting markers
 * (`*bold*`, `_italic_`, `~strike~`, code, a quote, lists) into the text, which Slack and the chat read as formatting; while choices are showing those keys are the box's,
 * otherwise `onKeyDown` gets them (send on Enter, cancel on Escape).
 */
export default function MentionTextarea({
  channelId,
  value,
  onValueChange,
  tokens,
  textareaRef,
  onKeyDown,
  toolbar = true,
  ...rest
}: {
  channelId: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Shown name to Slack markup for each person or channel picked; the owner reads it when sending. */
  tokens: MutableRefObject<Map<string, string>>;
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
  /** Show the formatting buttons over the box (on by default). */
  toolbar?: boolean;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [choices, setChoices] = useState<MentionSuggestion[]>([]);
  const [emoji, setEmoji] = useState<EmojiChoice[]>([]);
  const latest = useRef("");
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

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
        return;
      }
      const found = await suggestMentions(channelId, open.trigger, open.query).catch(() => []);
      // An answer to something typed since is stale.
      if (latest.current !== key) return;
      setChoices(found);
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, channelId]);

  // After a pick the text changes; put the caret behind the inserted name once it has.
  useLayoutEffect(() => {
    if (pendingSelection.current && inner.current) {
      inner.current.setSelectionRange(pendingSelection.current.start, pendingSelection.current.end);
      pendingSelection.current = null;
    }
  });

  // Grow with the text (and shrink back when it is cleared), up to a limit.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    const wanted = el.scrollHeight;
    if (wanted > 0) el.style.height = `${Math.min(wanted, MAX_BOX_HEIGHT_PX)}px`;
    el.style.overflowY = wanted > MAX_BOX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  /** Pasted `@Full Name`s that are exactly one known person become real mentions, as in Slack. */
  const pasteMentions = async (pasted: string, start: number, end: number) => {
    const found = await Promise.all(pastedNameCandidates(pasted).map((name) => suggestMentions(channelId, "@", name).catch(() => [])));
    const people = found
      .flat()
      .filter((p) => p.label.startsWith("@") && (!tokens.current.has(p.label) || tokens.current.get(p.label) === p.token))
      .filter((p, i, all) => all.findIndex((q) => q.token === p.token) === i);
    const { text, picked } = applyPastedMentions(pasted, people);
    for (const [label, token] of picked) tokens.current.set(label, token);
    pendingSelection.current = { start: start + text.length, end: start + text.length };
    onValueChange(`${value.slice(0, start)}${text}${value.slice(end)}`);
  };

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
    pendingSelection.current = { start: open.start + shown.length + 1, end: open.start + shown.length + 1 };
    onValueChange(next);
    setOpen(null);
    setChoices([]);
  };

  const pickEmoji = (choice: EmojiChoice, via: "keyboard" | "pointer") => {
    if (!open || !inner.current) return;
    track("chat_emoji_suggestion_picked", { custom: "url" in choice.emoji, via });
    const caret = inner.current.selectionStart ?? value.length;
    // The emoji itself when there is one; a custom emoji has no character, so its :shortcode: stands in.
    const shown = `${"text" in choice.emoji ? choice.emoji.text : `:${choice.name}:`} `;
    pendingSelection.current = { start: open.start + shown.length, end: open.start + shown.length };
    onValueChange(`${value.slice(0, open.start)}${shown}${value.slice(caret)}`);
    setOpen(null);
    setEmoji([]);
  };

  const items: unknown[] = open?.trigger === ":" ? emoji : choices;
  const showing = open !== null && items.length > 0;
  const combobox = useComboboxKeys({
    count: showing ? items.length : 0,
    options: items,
    preselect: true,
    pickOnTab: true,
    onPick: (i) => (open?.trigger === ":" ? pickEmoji(emoji[i], "keyboard") : pick(choices[i])),
    onEscape: () => {
      if (!open) return false;
      setOpen(null);
      return true;
    },
  });
  const aria = combobox.inputProps(showing);

  const format = (kind: FormatKind) => {
    const el = inner.current;
    if (!el) return;
    const edit = applyFormat(value, el.selectionStart ?? value.length, el.selectionEnd ?? value.length, kind);
    pendingSelection.current = { start: edit.start, end: edit.end };
    onValueChange(edit.value);
    setOpen(null);
    el.focus();
    track("chat_format_applied", { kind, via: "toolbar" });
  };

  return (
    <div className="relative">
      {toolbar && <FormatToolbar onFormat={format} />}
      <textarea
        {...rest}
        // Only emoji so far: large, like the message will be.
        style={isEmojiOnly(value) ? { ...rest.style, fontSize: "2rem", lineHeight: 1.2 } : rest.style}
        ref={setRef}
        value={value}
        aria-autocomplete={aria["aria-autocomplete"]}
        aria-controls={showing ? aria["aria-controls"] : undefined}
        aria-activedescendant={aria["aria-activedescendant"]}
        onPaste={(e) => {
          rest.onPaste?.(e);
          const pasted = e.clipboardData.getData("text/plain");
          if (e.defaultPrevented || !pasted.includes("@") || pastedNameCandidates(pasted).length === 0) return;
          e.preventDefault();
          void pasteMentions(pasted, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
        }}
        onChange={(e) => {
          let next = e.target.value;
          let caret = e.target.selectionStart ?? next.length;
          // Typing a space or punctuation after an emoticon turns it into its emoji, like Slack.
          const typing = !(e.nativeEvent as InputEvent).inputType?.startsWith("delete");
          const converted = typing ? convertEmoticonBefore(next, caret) : null;
          if (converted) {
            next = converted.value;
            caret = converted.caret;
            pendingSelection.current = { start: caret, end: caret };
          }
          onValueChange(next);
          look(next, caret);
        }}
        onClick={(e) => look(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setOpen(null)}
        onKeyDown={(e) => {
          if (combobox.handleKey(e)) return;
          const shortcut = !e.nativeEvent.isComposing && toolbar ? shortcutFormat(e) : null;
          if (shortcut) {
            e.preventDefault();
            const el = e.currentTarget;
            const edit = applyFormat(value, el.selectionStart, el.selectionEnd, shortcut);
            pendingSelection.current = { start: edit.start, end: edit.end };
            onValueChange(edit.value);
            track("chat_format_applied", { kind: shortcut, via: "shortcut" });
            return;
          }
          onKeyDown?.(e);
        }}
      />
      {showing && open && (
        <ul
          {...combobox.listboxProps}
          aria-label={open.trigger === "@" ? "People" : open.trigger === "#" ? "Channels" : "Emoji"}
          className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-72 max-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {(open.trigger === ":" ? emoji.map((e) => ({ key: e.name, label: `:${e.name}:`, onPick: () => pickEmoji(e, "pointer"), lead: <Emoji name={e.name} custom={{ [e.name]: e.emoji }} /> })) : choices.map((c) => ({ key: c.token, label: c.label, onPick: () => pick(c), lead: open.trigger === "@" ? <MemberAvatar name={c.label.slice(1)} photoUrl={c.photoUrl} size={20} /> : null }))).map((c, i) => (
            <li
              key={c.key}
              {...combobox.optionProps(i)}
              // mousedown, not click: the box would lose focus (and close the list) before a click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                c.onPick();
              }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === combobox.activeIndex ? "bg-plum-50 dark:bg-slate-800" : ""}`}
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

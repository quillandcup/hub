"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import { suggestCustomEmoji, suggestMentions, type MentionSuggestion } from "@/app/(member)/chat/mention-actions";
import { Emoji } from "@/components/chat/ChatText";
import FormatToolbar from "@/components/chat/FormatToolbar";
import { messageBoxExtensions } from "@/components/chat/message-box-extensions";
import { track } from "@/lib/analytics/client";
import type { CustomEmoji } from "@/lib/chat/emoji";
import { emojiChoices, loadCatalog, type EmojiChoice } from "@/lib/chat/emoji-suggest";
import { convertEmoticonBefore } from "@/lib/chat/emoticons";
import { applyPastedMentions, pastedNameCandidates } from "@/lib/chat/paste-mentions";
import { shortcutFormat } from "@/lib/chat/format-text";
import { docIsEmojiOnly, docToMrkdwn, mrkdwnToDoc, type EmojiLookup, type RichNode } from "@/lib/chat/rich-text";
import { useComboboxKeys } from "@/lib/hooks/useComboboxKeys";

const SUGGEST_DELAY_MS = 120;
/** The box grows with its text up to this height, then scrolls. */
export const MAX_BOX_HEIGHT_PX = 240;
/** A pasted web or mail address on its own: the editor links it (or the text it is pasted over), never a mention paste. */
const PASTED_ADDRESS = /^\s*(?:https?:\/\/|mailto:)\S+\s*$/i;

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

/** A key press as the box's owner sees it (the owner decides what Enter and Escape do). */
export type BoxKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey"> & {
  nativeEvent: KeyboardEvent;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/** A paste as the box's owner sees it (the owner takes pasted files). */
export type BoxPasteEvent = { clipboardData: DataTransfer | null; preventDefault: () => void };

/** What an owner can ask of the box. */
export type MessageBoxHandle = { focus: () => void };

const boxKeyEvent = (e: KeyboardEvent): BoxKeyEvent => ({
  key: e.key,
  shiftKey: e.shiftKey,
  metaKey: e.metaKey,
  ctrlKey: e.ctrlKey,
  altKey: e.altKey,
  nativeEvent: e,
  preventDefault: () => e.preventDefault(),
  stopPropagation: () => e.stopPropagation(),
});

// The editor's content drawn like the sent message (ChatText): lists, quotes, code and links. The tailwind reset
// strips them, so they are put back here for the editor's elements only.
/**
 * Backspace on an empty line of a quote steps out of the quote, as in Slack, so a comment can follow what is quoted. (The
 * editor's own Backspace would join the empty line back onto the quoted one.) The empty line is an empty paragraph in the
 * quote, or what is left after a soft line break at the end of one. Returns whether it acted.
 */
export function leaveQuoteFromEmptyLine(editor: Editor): boolean {
  const { selection } = editor.state;
  const { $from } = selection;
  if (!selection.empty || !editor.isActive("blockquote") || $from.parent.type.name !== "paragraph") return false;
  const afterBreak = $from.nodeBefore?.type.name === "hardBreak" && $from.parentOffset === $from.parent.content.size;
  if (afterBreak) {
    return editor.chain().command(({ tr }) => !!tr.delete($from.pos - 1, $from.pos)).splitBlock().lift("blockquote").run();
  }
  if ($from.parent.content.size === 0 && $from.index($from.depth - 1) > 0) return editor.commands.lift("blockquote");
  return false;
}

const CONTENT_STYLES = [
  "[&_.ProseMirror]:outline-none",
  "[&_.ProseMirror_p]:m-0",
  "[&_.ProseMirror_ul]:my-0.5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
  "[&_.ProseMirror_ol]:my-0.5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
  "[&_.ProseMirror_blockquote]:my-0.5 [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-slate-500 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-slate-600 dark:[&_.ProseMirror_blockquote]:border-slate-500 dark:[&_.ProseMirror_blockquote]:text-slate-400",
  "[&_.ProseMirror_pre]:my-1 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded [&_.ProseMirror_pre]:border [&_.ProseMirror_pre]:border-slate-200 [&_.ProseMirror_pre]:bg-slate-100 [&_.ProseMirror_pre]:p-2 [&_.ProseMirror_pre]:font-mono [&_.ProseMirror_pre]:text-sm dark:[&_.ProseMirror_pre]:border-slate-700 dark:[&_.ProseMirror_pre]:bg-slate-800",
  "[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:border [&_.ProseMirror_code]:border-slate-200 [&_.ProseMirror_code]:bg-slate-100 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-[0.9em] [&_.ProseMirror_code]:text-red-700 dark:[&_.ProseMirror_code]:border-slate-700 dark:[&_.ProseMirror_code]:bg-slate-800 dark:[&_.ProseMirror_code]:text-red-400",
  "[&_.ProseMirror_pre_code]:border-0 [&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0 [&_.ProseMirror_pre_code]:text-inherit",
  "[&_.ProseMirror_a]:font-medium [&_.ProseMirror_a]:text-plum-700 [&_.ProseMirror_a]:underline dark:[&_.ProseMirror_a]:text-plum-300",
].join(" ");

/** Only emoji so far: drawn large, like the message will be. */
const JUMBO_STYLES = "[&_.ProseMirror]:!text-[2rem] [&_.ProseMirror]:!leading-tight";

/**
 * The box a member writes a message in, showing the formatting as it is written (bold, italics, lists, quotes, code,
 * links, custom emoji as images), like Slack's. Its owners still deal in text: `value` is Slack's mrkdwn (`*bold*`,
 * `> quote`, `<https://x|link>`, `:emoji:`; lib/chat/rich-text.ts turns it to and from the editor's document), with
 * people and channels shown by name.
 *
 * It offers people (`@`), channels (`#`) and emoji (`:pray`) as they are typed. Picking a person or channel writes
 * its name and remembers what Slack needs for it in `tokens` (shown name to `<@U…>`), which the owner turns the text
 * back into Slack's markup with on send (`fromEditableText`). The choices' keys are the shared `useComboboxKeys`.
 * A toolbar over the box (and Ctrl/Cmd+B, +I, +Shift+X) formats the selection; typing `*word*`, a `> `, `- ` or `1. `
 * does too, and pasting an address over selected text links it.
 *
 * Enter and Escape go to the owner's `onKeyDown` (send on Enter, cancel on Escape), except that Enter inside a list or
 * code block is the editor's (a new item, a new line) unless Ctrl/Cmd is held.
 */
export default function MessageBox({
  channelId,
  value,
  onValueChange,
  tokens,
  boxRef,
  onKeyDown,
  onPaste,
  placeholder,
  maxLength,
  autoFocus,
  id,
  "aria-label": ariaLabel,
  rows = 2,
  className = "",
  toolbar = true,
  customEmoji,
}: {
  channelId: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Shown name to Slack markup for each person or channel picked; the owner reads it when sending. */
  tokens: MutableRefObject<Map<string, string>>;
  boxRef?: MutableRefObject<MessageBoxHandle | null>;
  onKeyDown?: (e: BoxKeyEvent) => void;
  onPaste?: (e: BoxPasteEvent) => void;
  /** Shown while the box is empty, and its name for assistive technology unless `aria-label` says otherwise. */
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  id?: string;
  "aria-label"?: string;
  /** How many lines tall the box is at least. */
  rows?: number;
  /** Padding, text size and the like for the editable area. */
  className?: string;
  /** Show the formatting buttons over the box (on by default). */
  toolbar?: boolean;
  /** Custom emoji the text may already use (an edited message's), so `:name:` in it shows as the image. */
  customEmoji?: Record<string, CustomEmoji>;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const [choices, setChoices] = useState<MentionSuggestion[]>([]);
  const [emoji, setEmoji] = useState<EmojiChoice[]>([]);
  const latest = useRef("");
  // Custom emoji picked in this box, so text put back into it later (after a failed send) shows their images again.
  const known = useRef(new Map<string, CustomEmoji>());
  const live = useRef({ onValueChange, onKeyDown, onPaste, customEmoji });
  useEffect(() => {
    live.current = { onValueChange, onKeyDown, onPaste, customEmoji };
  });
  const editorRef = useRef<Editor | null>(null);
  const lookup = useMemo<EmojiLookup>(
    () => (name) => {
      const found = known.current.get(name) ?? live.current.customEmoji?.[name];
      return found ?? null;
    },
    []
  );
  const extensions = useMemo(() => messageBoxExtensions(maxLength), [maxLength]);

  // Which suggestion list the caret is in, if any: the text before the caret in its paragraph.
  const look = (ed: Editor) => {
    const { $from, empty } = ed.state.selection;
    let found: Open | null = null;
    if (empty && $from.parent.isTextblock && $from.parent.type.name !== "codeBlock") {
      // Emoji images count as one character each, as they do in the document's positions.
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
      const hit = triggerBefore(before, before.length);
      if (hit) found = { ...hit, start: $from.pos - (before.length - hit.start) };
    }
    if (!found || found.trigger !== open?.trigger) {
      setChoices([]);
      setEmoji([]);
    }
    setOpen(found);
  };

  const handleUpdate = (ed: Editor) => {
    const json = ed.getJSON() as RichNode;
    live.current.onValueChange(docToMrkdwn(json));
    look(ed);
  };

  /** Typing a space or punctuation after an emoticon (`:)`, `<3`) turns it into its emoji, like Slack. */
  const convertEmoticon = (view: EditorView, from: number, to: number, text: string): boolean => {
    if (text.length !== 1) return false;
    const $from = view.state.doc.resolve(from);
    if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock" || $from.marks().some((m) => m.type.name === "code")) return false;
    const prefix = `${$from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC")}${text}`;
    const converted = convertEmoticonBefore(prefix, prefix.length);
    if (!converted) return false;
    // The emoticon starts where the two texts first differ; what follows is the emoji and the character just typed.
    let index = 0;
    while (prefix[index] === converted.value[index]) index++;
    view.dispatch(view.state.tr.insertText(converted.value.slice(index), $from.start() + index, to));
    return true;
  };

  /** Pasted `@Full Name`s that are exactly one known person become real mentions, as in Slack; the rest is text as pasted. */
  const pasteMentions = async (pasted: string, from: number, to: number) => {
    const found = await Promise.all(pastedNameCandidates(pasted).map((name) => suggestMentions(channelId, "@", name).catch(() => [])));
    const people = found
      .flat()
      .filter((p) => p.label.startsWith("@") && (!tokens.current.has(p.label) || tokens.current.get(p.label) === p.token))
      .filter((p, i, all) => all.findIndex((q) => q.token === p.token) === i);
    const { text, picked } = applyPastedMentions(pasted, people);
    for (const [label, token] of picked) tokens.current.set(label, token);
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    const size = editor.state.doc.content.size;
    const content: JSONContent[] = text.split("\n").flatMap((line, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]);
    editor.chain().focus().insertContentAt({ from: Math.min(from, size), to: Math.min(to, size) }, content).run();
  };

  const pasteMentionsRef = useRef(pasteMentions);
  useEffect(() => {
    pasteMentionsRef.current = pasteMentions;
  });

  // What the editor starts with (read once: later changes to `value` come in through the effect below).
  const [initialContent] = useState(() => mrkdwnToDoc(value, (name) => customEmoji?.[name] ?? null) as JSONContent);
  const editor = useEditor({
    extensions,
    content: initialContent,
    // Rendered on the client only: the editor builds its document from the browser's DOM.
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel ?? placeholder ?? "Message",
        ...(id ? { id } : {}),
        class: className,
        style: `min-height: ${rows * 1.25 + 1}rem; max-height: ${MAX_BOX_HEIGHT_PX}px; overflow-y: auto`,
      },
      handleKeyDown: (view, event) => keyDownRef.current(event),
      handleTextInput: (view, from, to, text) => convertEmoticon(view, from, to, text),
      handlePaste: (view, event) => {
        live.current.onPaste?.({ clipboardData: event.clipboardData, preventDefault: () => event.preventDefault() });
        if (event.defaultPrevented) return true;
        const pasted = event.clipboardData?.getData("text/plain") ?? "";
        if (!pasted.includes("@") || PASTED_ADDRESS.test(pasted) || pastedNameCandidates(pasted).length === 0) return false;
        event.preventDefault();
        void pasteMentionsRef.current(pasted, view.state.selection.from, view.state.selection.to);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => handleUpdate(ed),
    onSelectionUpdate: ({ editor: ed }) => look(ed),
    onBlur: () => setOpen(null),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Text put in from outside (cleared after a send, an edit started, a failed send's text put back) replaces the document.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const json = editor.getJSON() as RichNode;
    if (docToMrkdwn(json) === value) return;
    const next = mrkdwnToDoc(value, lookup);
    editor.commands.setContent(next as JSONContent, { emitUpdate: false });
    editor.commands.setTextSelection(editor.state.doc.content.size);
  }, [editor, value, lookup]);

  useEffect(() => {
    if (!boxRef) return;
    boxRef.current = editor ? { focus: () => void editor.commands.focus("end") } : null;
    return () => {
      boxRef.current = null;
    };
  }, [editor, boxRef]);

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

  const close = () => {
    setOpen(null);
    setChoices([]);
    setEmoji([]);
  };

  /** Replaces what was typed after the trigger (`@Ani`) with the pick, then a space, and leaves the caret behind it. */
  const insert = (content: JSONContent[]) => {
    if (!open || !editor) return;
    editor.chain().focus().insertContentAt({ from: open.start, to: editor.state.selection.to }, content).run();
    close();
  };

  const pick = (choice: MentionSuggestion) => {
    // Two people with one name keep their own markup under a told-apart name.
    const base = choice.label;
    let shown = base;
    for (let n = 2; tokens.current.has(shown) && tokens.current.get(shown) !== choice.token; n++) shown = `${base} (${n})`;
    tokens.current.set(shown, choice.token);
    insert([{ type: "text", text: `${shown} ` }]);
  };

  const pickEmoji = (choice: EmojiChoice, via: "keyboard" | "pointer") => {
    track("chat_emoji_suggestion_picked", { custom: !choice.standard, via });
    if (choice.standard) return insert([{ type: "text", text: `${"text" in choice.emoji ? choice.emoji.text : ""} ` }]);
    // A custom emoji has no character: it goes in as its image (and is sent as `:name:`).
    known.current.set(choice.name, choice.emoji);
    insert([
      { type: "emoji", attrs: { name: choice.name, url: "url" in choice.emoji ? choice.emoji.url : null, text: "text" in choice.emoji ? choice.emoji.text : null } },
      { type: "text", text: " " },
    ]);
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
      close();
      return true;
    },
  });
  const aria = combobox.inputProps(showing);

  // The editor's own key handler is made once, so it reads the current state through this.
  const keyDownRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  useEffect(() => {
    keyDownRef.current = (event) => {
      const e = boxKeyEvent(event);
      if (combobox.handleKey(e)) return true;
      if (event.isComposing) return false;
      const shortcut = toolbar ? shortcutFormat(e) : null;
      // The editor applies its own shortcuts; this only records them.
      if (shortcut) track("chat_format_applied", { kind: shortcut, via: "shortcut" });
      // Enter in a list or code block adds an item or a line; Ctrl/Cmd+Enter sends from anywhere.
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && (editor?.isActive("bulletList") || editor?.isActive("orderedList") || editor?.isActive("codeBlock"))) return false;
      if (event.key === "Backspace" && !event.shiftKey && !event.metaKey && !event.ctrlKey && editor && leaveQuoteFromEmptyLine(editor)) return true;
      live.current.onKeyDown?.(e);
      return event.defaultPrevented;
    };
  });

  // The list's state on the editable element, for assistive technology.
  useEffect(() => {
    const dom = editor?.view?.dom;
    if (!dom) return;
    dom.setAttribute("aria-autocomplete", aria["aria-autocomplete"]);
    if (showing) dom.setAttribute("aria-controls", aria["aria-controls"]);
    else dom.removeAttribute("aria-controls");
    const active = aria["aria-activedescendant"];
    if (active) dom.setAttribute("aria-activedescendant", active);
    else dom.removeAttribute("aria-activedescendant");
  });

  const empty = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return true;
      // An empty quote, list or code block counts as empty to the editor, but it has a mark of its own on screen: the placeholder only goes on a plain empty line.
      const { doc } = e.state;
      return doc.childCount === 1 && doc.firstChild?.type.name === "paragraph" && doc.firstChild.content.size === 0;
    },
  });
  const jumbo = useEditorState({ editor, selector: ({ editor: e }) => (e ? docIsEmojiOnly(e.getJSON() as RichNode) : false) });

  return (
    <div className="relative">
      {toolbar && editor && <FormatToolbar editor={editor} onFormat={(kind) => track("chat_format_applied", { kind, via: "toolbar" })} />}
      <div className={`relative ${CONTENT_STYLES} ${jumbo ? JUMBO_STYLES : ""}`} style={editor ? undefined : { minHeight: `${rows * 1.25 + 1}rem` }}>
        <EditorContent editor={editor} />
        {empty && placeholder && (
          // Drawn where the owner's padding puts the text (px-3 py-2).
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-2 text-sm text-slate-500 dark:text-slate-400">
            {placeholder}
          </span>
        )}
      </div>
      {showing && open && (
        <ul
          {...combobox.listboxProps}
          aria-label={open.trigger === "@" ? "People" : open.trigger === "#" ? "Channels" : "Emoji"}
          className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-72 max-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {(open.trigger === ":"
            ? emoji.map((e) => ({ key: e.name, label: `:${e.name}:`, onPick: () => pickEmoji(e, "pointer"), lead: <Emoji name={e.name} custom={{ [e.name]: e.emoji }} /> }))
            : choices.map((c) => ({
                key: c.token,
                label: c.label,
                onPick: () => pick(c),
                lead: open.trigger === "@" ? <MemberAvatar name={c.label.slice(1)} photoUrl={c.photoUrl} size={20} /> : null,
              }))
          ).map((c, i) => (
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

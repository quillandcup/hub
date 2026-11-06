import { Extension, Node, markInputRule, type Extensions } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { AddMarkStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MAX_LIST_INDENT } from "@/lib/chat/render";
import StarterKit from "@tiptap/starter-kit";

/**
 * A custom (or aliased) emoji in the box: drawn as its image, or the character it is an alias for, and written
 * out as `:name:` (lib/chat/rich-text.ts). An atom, so the caret moves over it and Backspace takes it whole.
 */
export const EmojiNode = Node.create({
  name: "emoji",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      name: { default: "" },
      url: { default: null },
      text: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-emoji]",
        getAttrs: (el) => ({ name: el.getAttribute("data-emoji"), url: el.getAttribute("data-url"), text: el.getAttribute("data-text") }),
      },
    ];
  },

  renderHTML({ node }) {
    const { name, url, text } = node.attrs as { name: string; url: string | null; text: string | null };
    const data = { "data-emoji": name, ...(url ? { "data-url": url } : {}), ...(text ? { "data-text": text } : {}), title: `:${name}:`, contenteditable: "false" };
    // The image is the emoji; its alt text is what copying it as plain text gives.
    return url
      ? ["span", data, ["img", { src: url, alt: `:${name}:`, draggable: "false", class: "inline-block h-[1.25em] w-[1.25em] align-text-bottom" }]]
      : ["span", data, text ?? `:${name}:`];
  },

  renderText({ node }) {
    return `:${node.attrs.name}:`;
  },
});

/** Typing `*word*`, `_word_` or `~word~` makes it bold, italic or struck through, as Slack does (the editor's own rules are `**` and `__`). */
const SlackMarkdownRules = Extension.create({
  name: "slackMarkdownRules",
  addInputRules() {
    const marks = this.editor.schema.marks;
    const rule = (find: RegExp, type: string) => markInputRule({ find, type: marks[type] });
    return [
      rule(/(?:^|\s)(\*(?!\s+\*)([^*]+)\*(?!\s+\*))$/, "bold"),
      rule(/(?:^|\s)(_(?!\s+_)([^_]+)_(?!\s+_))$/, "italic"),
      rule(/(?:^|\s)(~(?!\s+~)([^~]+)~(?!\s+~))$/, "strike"),
    ];
  },
});

/** Cmd/Ctrl+Shift+X strikes through, as in Slack (the editor's own shortcut is Shift+S). */
const SlackShortcuts = Extension.create({
  name: "slackShortcuts",
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
  },
});

/** Stops the box growing past `maxLength` characters of text (typing and pasting are refused once it is full). */
const maxLengthExtension = (limit: number) =>
  Extension.create({
    name: "maxLength",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("maxLength"),
          // A change that makes the text longer than the limit is refused; one that shortens it (or an already long text being cut down) is not.
          filterTransaction: (tr) => !tr.docChanged || tr.doc.textContent.length <= limit || tr.doc.textContent.length <= tr.before.textContent.length,
        }),
      ];
    },
  });

const LISTS = new Set(["bulletList", "orderedList"]);

/** How many lists deep the deepest item is nested (a list in a list item of a list is 2). */
const listDepth = (node: PMNode): number => {
  let deepest = 0;
  node.forEach((child) => {
    deepest = Math.max(deepest, listDepth(child));
  });
  return deepest + (LISTS.has(node.type.name) ? 1 : 0);
};

/** What the box changed on its own just now, which Ctrl/Cmd+Z takes back (and only that): see `UndoConversion`. */
export type Conversion =
  // Typing turned `original` into what is now between `from` and `to` (a curly quote, an em-dash, an emoji).
  | { kind: "text"; from: number; to: number; original: string }
  // Typing a space after an address made the text between `from` and `to` a link.
  | { kind: "link"; from: number; to: number };

/** Dispatch a transaction with this meta set to a `Conversion` to make it the one Ctrl/Cmd+Z undoes next. */
export const undoConversionKey = new PluginKey<Conversion | null>("undoConversion");

/**
 * Ctrl/Cmd+Z right after the box converted something as you typed (`--` to an em-dash, a quote to a curly one, `:)` to its emoji, an
 * address to a link) takes back only that: the text goes back to what was typed, or the link comes off the word and the word stays.
 * The editor's own undo would take back everything typed in the same half second, because it groups quick typing. Once anything
 * else is typed, or the caret moves, it is the editor's own undo again.
 */
const UndoConversion = Extension.create({
  name: "undoConversion",
  // Before the editor's own undo, which also listens for this key.
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin<Conversion | null>({
        key: undoConversionKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const set = tr.getMeta(undoConversionKey) as Conversion | null | undefined;
            if (set !== undefined) return set;
            // The editor adds a link mark to an address by appending a transaction to the one that typed the space after it.
            if (tr.getMeta("appendedTransaction")) {
              const link = tr.steps.filter((step): step is AddMarkStep => step instanceof AddMarkStep && step.mark.type.name === "link").pop();
              return link ? { kind: "link", from: link.from, to: link.to } : value;
            }
            return tr.docChanged || tr.selectionSet ? null : value;
          },
        },
        props: {
          handleKeyDown(view, event) {
            if (event.key.toLowerCase() !== "z" || event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) return false;
            const conversion = undoConversionKey.getState(view.state);
            if (!conversion) return false;
            const { tr, schema } = view.state;
            if (conversion.kind === "text") tr.insertText(conversion.original, conversion.from, conversion.to);
            else tr.removeMark(conversion.from, conversion.to, schema.marks.link);
            view.dispatch(tr.setMeta(undoConversionKey, null));
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * A deliberate difference from Slack: our lists are nested (an item's deeper items belong to it), where Slack's are flat (every
 * item has its own indent, and changing one never moves another). So when you back an item out with Backspace, or lift it, the
 * items under it come with it, one level up, and no level is ever skipped. Slack leaves them where they were, with a gap; that
 * is a quirk of its flat model, and this is the better behavior. What the chat reads back (`listLine` in lib/chat/render.ts)
 * closes up a skipped level in a message written in Slack the same way. Pinned in tests/components/MessageBox.test.tsx.
 *
 * Lists go five levels deep, as in Slack (past that it can neither show nor send them): a change that nests one deeper is
 * refused (Tab on an item that is already at the fifth level does nothing). Each list also gets `data-list-depth`, which
 * the box's styles use to give a level its marker the way Slack does (•, ◦, ▪, •, ◦ and 1., a., i., 1., a.).
 */
const ListDepth = Extension.create({
  name: "listDepth",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("listDepth"),
        filterTransaction: (tr) => !tr.docChanged || listDepth(tr.doc) <= MAX_LIST_INDENT + 1 || listDepth(tr.doc) <= listDepth(tr.before),
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!LISTS.has(node.type.name)) return;
              const $pos = state.doc.resolve(pos);
              let depth = 0;
              for (let d = $pos.depth; d > 0; d--) if (LISTS.has($pos.node(d).type.name)) depth++;
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { "data-list-depth": String(depth) }));
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/**
 * What the message box edits: paragraphs, bold, italic, strikethrough, code, code blocks, quotes, lists and links.
 * Only what a Slack message can say; no headings or rules. Underline is here too, but Slack's mrkdwn has none, so a message
 * with one is sent as rich-text blocks (lib/chat/rich-blocks.ts).
 */
export function messageBoxExtensions(maxLength?: number): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      trailingNode: false,
      // (mailto: is one of linkify's own schemes; registering it again after linkify has run, as a second editor would, logs a warning.)
      // A typed or pasted address becomes a link, and pasting one over selected text links that text.
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
    }),
    EmojiNode,
    SlackMarkdownRules,
    SlackShortcuts,
    ListDepth,
    UndoConversion,
    ...(maxLength === undefined ? [] : [maxLengthExtension(maxLength)]),
  ];
}

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EditorContent, Extension, Node as TiptapNode, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type NodeViewProps } from "@tiptap/react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Icon from "@/components/Icon";
import Pill from "@/components/Pill";
import Tooltip from "@/components/Tooltip";
import { oneLine, toDoc, toText } from "@/components/landing/placeholder-doc";
import { documentNonce } from "@/lib/csp-nonce";
import { placeholderDef, placeholderToken, resolvePlaceholders, splitPlaceholders, type PlaceholderDef, type PlaceholderName } from "@/lib/landing/placeholders";
import { clock } from "@/lib/clock";
import { useDismissOutside } from "@/lib/hooks/useDismissOutside";

/**
 * A single line of plain text in which placeholders (`{year}`, `{year:2019}`; `src/lib/landing/placeholders.ts`) are pills. The value it
 * reads and writes is the plain token string, so what is stored is unchanged by how it is edited.
 *
 * - One line: Enter does nothing (it never submits a form around it), pasted line breaks become spaces, and pasting gives plain text
 *   (a pasted `{year}` becomes a pill, as does one typed in full).
 * - A pill is one unit. Backspace or Delete beside it removes all of it; arrow onto it and Delete does too; hovering shows a ×
 *   in its corner. A pill that takes a parameter opens a small box to change it when clicked (or on Enter once selected).
 * - Only what a field opts into with `placeholders` is offered in the button inside the box: one list, from the registry.
 */

/** A pill that takes a parameter asks the field to open its edit box with this event (it bubbles up to the field's own element). */
const EDIT_EVENT = "placeholder-edit";
interface EditRequest {
  pos: number;
  anchor: HTMLElement | null;
}
function requestEdit(from: Element, request: EditRequest) {
  from.dispatchEvent(new CustomEvent<EditRequest>(EDIT_EVENT, { bubbles: true, detail: request }));
}

function PlaceholderView({ node, selected, getPos, editor, deleteNode }: NodeViewProps) {
  const name = String(node.attrs.name);
  const param = (node.attrs.param as string | null) ?? undefined;
  const def = placeholderDef(name);
  const label = def ? def.pillLabel(param) : name;
  return (
    <NodeViewWrapper as="span" data-placeholder={name} className="mx-0.5 inline-block align-baseline">
      <Pill role="group" aria-label={`${label} placeholder`} selected={selected} removeStyle="corner" removeLabel={`Remove ${def?.label ?? name} placeholder`} onRemove={deleteNode}>
        {def?.param ? (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              const pos = getPos();
              if (pos !== undefined) requestEdit(e.currentTarget, { pos, anchor: e.currentTarget });
            }}
            className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-plum-500"
          >
            {label}
          </button>
        ) : (
          label
        )}
      </Pill>
    </NodeViewWrapper>
  );
}

const PlaceholderNode = TiptapNode.create({
  name: "placeholder",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { name: { default: "" }, param: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-placeholder]", getAttrs: (el) => ({ name: (el as HTMLElement).getAttribute("data-placeholder"), param: (el as HTMLElement).getAttribute("data-param") }) }];
  },
  renderHTML({ node }) {
    const param = node.attrs.param as string | null;
    return ["span", { "data-placeholder": node.attrs.name, ...(param ? { "data-param": param } : {}) }, placeholderToken(node.attrs.name, param)];
  },
  // Copying a pill as plain text gives the token, which pastes back as a pill.
  renderText: ({ node }) => placeholderToken(node.attrs.name, node.attrs.param),
  addNodeView() {
    return ReactNodeViewRenderer(PlaceholderView, { as: "span" });
  },
});

/** One paragraph and nothing else: no second line, no list, no heading. */
const OneLineDocument = TiptapNode.create({ name: "doc", topNode: true, content: "paragraph" });

const PlaceholderBehavior = Extension.create({
  name: "placeholderBehavior",
  // Before the editor's own Enter and Backspace.
  priority: 1000,
  addKeyboardShortcuts() {
    // Backspace or Delete right beside a pill takes the whole pill, not a character of a token.
    const removeBeside = (direction: -1 | 1) => () => {
      const { selection } = this.editor.state;
      if (!selection.empty) return false;
      const node = direction < 0 ? selection.$from.nodeBefore : selection.$from.nodeAfter;
      if (node?.type.name !== "placeholder") return false;
      const from = direction < 0 ? selection.from - node.nodeSize : selection.from;
      return this.editor.commands.deleteRange({ from, to: from + node.nodeSize });
    };
    return {
      Backspace: removeBeside(-1),
      Delete: removeBeside(1),
      // One line: Enter never splits it. On a selected pill that takes a parameter it opens the edit box instead.
      Enter: () => {
        const { selection } = this.editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === "placeholder" && placeholderDef(selection.node.attrs.name)?.param) {
          const dom = this.editor.view.nodeDOM(selection.from);
          requestEdit(this.editor.view.dom, { pos: selection.from, anchor: dom instanceof HTMLElement ? dom : null });
        }
        return true;
      },
      "Shift-Enter": () => true,
    };
  },
  addProseMirrorPlugins() {
    const type = this.editor.schema.nodes.placeholder;
    return [
      new Plugin({
        key: new PluginKey("placeholderTokens"),
        // A token typed or pasted in full (`{year}`) becomes its pill.
        appendTransaction: (transactions, _before, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const found: { from: number; to: number; name: string; param: string | null }[] = [];
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            let offset = 0;
            for (const s of splitPlaceholders(node.text ?? "")) {
              const length = s.kind === "text" ? s.text.length : placeholderToken(s.name, s.param).length;
              if (s.kind === "placeholder") found.push({ from: pos + offset, to: pos + offset + length, name: s.name, param: s.param ?? null });
              offset += length;
            }
          });
          if (found.length === 0) return null;
          const tr = state.tr;
          for (const f of found.reverse()) tr.replaceWith(f.from, f.to, type.create({ name: f.name, param: f.param }));
          return tr;
        },
      }),
    ];
  },
});

interface EditState {
  pos: number;
  name: string;
  draft: string;
  left: number;
  top: number;
  error: string | null;
}

export interface PlaceholderTextFieldProps {
  value: string;
  onChange: (text: string) => void;
  /** The field's accessible name (the visible label is the caller's). */
  label: string;
  /** Which placeholders this field offers: names from the registry, usually `placeholdersFor("<surface>")`. An unknown name is a mistake and throws. */
  placeholders: readonly PlaceholderName[];
}

const POPOVER = "absolute z-dropdown rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900";
const SMALL = "rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800";

export default function PlaceholderTextField({ value, onChange, label, placeholders }: PlaceholderTextFieldProps) {
  const offered: PlaceholderDef[] = placeholders.map((name) => {
    const def = placeholderDef(name);
    if (!def) throw new Error(`Unknown placeholder "${name}": add it to PLACEHOLDERS in src/lib/landing/placeholders.ts`);
    return def;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const lastText = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [listOpen, setListOpen] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const listId = useId();
  const editId = useId();

  const extensions = useMemo(
    () => [
      OneLineDocument,
      StarterKit.configure({
        document: false,
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      PlaceholderNode,
      PlaceholderBehavior,
    ],
    []
  );

  const editor = useEditor({
    injectNonce: documentNonce(), // TipTap's own style tag needs the page's nonce (src/lib/csp-nonce.ts)
    extensions,
    content: toDoc(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "false",
        "aria-label": label,
        class: "min-h-9 w-full px-3 py-2 text-sm leading-7 focus:outline-none [&_p]:m-0",
      },
      // Plain text only, on one line; a token in it becomes a pill.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        view.dispatch(view.state.tr.insertText(oneLine(text)).scrollIntoView());
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const text = toText(e.getJSON());
      lastText.current = text;
      onChangeRef.current(text);
    },
  });
  // A pill's click, or Enter on a selected pill, asks for its edit box (see `requestEdit`).
  useEffect(() => {
    const host = containerRef.current;
    if (!host || !editor) return;
    const open = (e: Event) => {
      const { pos, anchor } = (e as CustomEvent<EditRequest>).detail;
      const node = editor.state.doc.nodeAt(pos);
      if (node?.type.name !== "placeholder") return;
      const box = host.getBoundingClientRect();
      const at = anchor?.getBoundingClientRect();
      setListOpen(false);
      setEdit({
        pos,
        name: node.attrs.name,
        draft: (node.attrs.param as string | null) ?? "",
        left: at ? Math.max(0, at.left - box.left) : 0,
        top: at ? at.bottom - box.top + 4 : 40,
        error: null,
      });
    };
    host.addEventListener(EDIT_EVENT, open);
    return () => host.removeEventListener(EDIT_EVENT, open);
  }, [editor]);

  // A value changed from outside (reset, bringing a version back) replaces what is in the box.
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === lastText.current) return;
    lastText.current = value;
    if (value !== toText(editor.getJSON())) editor.commands.setContent(toDoc(value), { emitUpdate: false });
  }, [value, editor]);

  const closePopups = () => {
    setListOpen(false);
    setEdit(null);
  };
  useDismissOutside(containerRef, listOpen || edit !== null, closePopups);

  function insert(def: PlaceholderDef) {
    editor?.chain().focus().insertContent({ type: "placeholder", attrs: { name: def.name, param: null } }).run();
    setListOpen(false);
  }

  function applyEdit() {
    if (!edit || !editor) return;
    const spec = placeholderDef(edit.name)?.param;
    const raw = edit.draft.trim();
    const param = raw === "" ? null : (spec?.parse(raw) ?? undefined);
    if (param === undefined) {
      setEdit({ ...edit, error: spec?.hint ?? "That value is not valid." });
      return;
    }
    const node = editor.state.doc.nodeAt(edit.pos);
    if (node?.type.name === "placeholder") editor.view.dispatch(editor.state.tr.setNodeMarkup(edit.pos, undefined, { ...node.attrs, param }));
    setEdit(null);
    editor.commands.focus();
  }

  const editDef = edit ? placeholderDef(edit.name) : undefined;
  const editSpec = editDef?.param;
  const editPreview = editDef && edit && editSpec && (edit.draft.trim() === "" || editSpec.parse(edit.draft.trim()) !== null)
    ? resolvePlaceholders(placeholderToken(edit.name, edit.draft.trim() || null), { nowMs: clock.now() })
    : null;
  const shown = resolvePlaceholders(value);

  return (
    <div ref={containerRef} className="relative mt-1">
      <div className="flex items-start rounded border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-plum-500/40 dark:border-slate-700 dark:bg-slate-900">
        <div className="min-w-0 flex-1">{editor ? <EditorContent editor={editor} /> : <p className="px-3 py-2 text-sm text-ink-muted">Loading…</p>}</div>
        {offered.length > 0 && (
          <Tooltip content="Add a placeholder">
            <button
              type="button"
              aria-label="Add a placeholder"
              aria-haspopup="dialog"
              aria-expanded={listOpen}
              aria-controls={listOpen ? listId : undefined}
              onClick={() => {
                setEdit(null);
                setListOpen((open) => !open);
              }}
              className="m-1 rounded p-1.5 text-slate-600 hover:bg-slate-100 aria-expanded:bg-plum-50 aria-expanded:text-plum-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name="placeholder" />
            </button>
          </Tooltip>
        )}
      </div>

      {listOpen && (
        <div id={listId} role="dialog" aria-label="Placeholders" className={`${POPOVER} right-0 top-full mt-1 w-80 max-w-full`}>
          <p className="mb-2 text-xs text-ink-muted">These fill themselves in when the text is shown.</p>
          <ul className="space-y-2">
            {offered.map((def) => (
              <li key={def.name} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{def.label}</p>
                  <p className="text-xs text-ink-muted">{def.description}</p>
                  <p className="text-xs">
                    Shows as: <span className="font-medium">{def.example({ nowMs: clock.now() })}</span>
                  </p>
                </div>
                <button type="button" className={SMALL} aria-label={`Insert ${def.label} placeholder`} onClick={() => insert(def)}>
                  Insert
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {edit && editSpec && (
        <div id={editId} role="dialog" aria-label={`${editDef?.label} placeholder`} className={`${POPOVER} w-64`} style={{ left: edit.left, top: edit.top }}>
          <label htmlFor={`${editId}-input`} className="block text-sm font-medium">
            {editSpec.label}
          </label>
          <input
            id={`${editId}-input`}
            type="text"
            inputMode="numeric"
            autoFocus
            value={edit.draft}
            aria-invalid={edit.error ? true : undefined}
            onChange={(e) => setEdit({ ...edit, draft: e.target.value, error: null })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Never submits a form around the field.
                e.preventDefault();
                applyEdit();
              }
            }}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <p className="mt-1 text-xs text-ink-muted">{editSpec.hint}</p>
          {edit.error && (
            <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {edit.error}
            </p>
          )}
          {editPreview && (
            <p className="mt-1 text-xs">
              Shows as: <span className="font-medium">{editPreview}</span>
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={SMALL} onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button type="button" className={SMALL} onClick={applyEdit}>
              Done
            </button>
          </div>
        </div>
      )}

      {shown !== value && (
        <p className="mt-1 text-sm text-ink-muted">
          Shows as: <span data-testid="placeholder-preview">{shown}</span>
        </p>
      )}
      <p className="mt-1 text-xs font-normal text-ink-muted">Use the placeholder button to add text that fills itself in, such as the year.</p>
    </div>
  );
}


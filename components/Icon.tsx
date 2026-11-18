import { ArrowUpDown, ChevronDown, Copy, Equal, EllipsisVertical, Eye, ExternalLink, Folder, Globe, GripVertical, History, Link, Lock, MessageSquare, Pencil, Plus, RotateCcw, Settings2, TextCursorInput, Trash2, Video, X, type LucideIcon } from "lucide-react";

/**
 * THE icon set: one name per meaning, drawn by `lucide-react`. Every admin list, builder and editor uses the same icon for
 * the same action, so a page asks for `<Icon name="edit" />` and never imports from `lucide-react` itself or pastes an
 * inline `<svg>` (`tests/lib/icons.test.ts` fails on both; rule: `.claude/rules/icons.md`). Names say what the icon MEANS
 * (edit, reset, delete), not what it looks like, so changing the picture for a meaning is one line here.
 *
 * - Need a meaning that isn't listed? Add it here, with the lucide icon that says it (https://lucide.dev/icons).
 * - Decorative: it is hidden from assistive tech, so an icon-only control carries its own `aria-label`.
 * - Size comes from `className` (default 16px); color is the text color.
 */
export const ICONS = {
  folder: Folder,
  video: Video,
  edit: Pencil,
  rename: TextCursorInput,
  copy: Copy,
  link: Link,
  comment: MessageSquare,
  eye: Eye,
  trash: Trash2,
  plus: Plus,
  chevron: ChevronDown,
  grip: Equal,
  dots: GripVertical,
  /** The overflow menu button: more actions for this row. */
  more: EllipsisVertical,
  /** Move this item up or down in its list: the "Move to position" menu for people who do not drag. */
  reorder: ArrowUpDown,
  /** Throw the draft away and start over from what is published. Not `undo`: that one steps back one edit. */
  reset: RotateCcw,
  /** Visible to others (members or the public): the globe. The writing visibility toggles use 🌐 for the same meaning. */
  publish: Globe,
  /** Back to only you or staff (a draft, private): the lock, as 🔒 on the writing visibility toggles and "Only you can see this". */
  unpublish: Lock,
  /** Earlier versions of something. */
  history: History,
  /** The settings of a thing itself (title, address, search text), as opposed to its content. */
  details: Settings2,
  /** Opens the live thing in another tab. */
  external: ExternalLink,
  /** Close a panel or dismiss something. */
  close: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden="true" className={className} strokeWidth={1.75} />;
}

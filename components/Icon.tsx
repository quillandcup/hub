import { ChevronDown, ChevronUp, Copy, Equal, Eye, EyeOff, Folder, Globe, GripVertical, History, Link, MessageSquare, Pencil, Plus, RotateCcw, TextCursorInput, Trash2, Video, type LucideIcon } from "lucide-react";

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
  up: ChevronUp,
  down: ChevronDown,
  /** Throw the draft away and start over from what is published. Not `undo`: that one steps back one edit. */
  reset: RotateCcw,
  /** Make it available to members or the public. */
  publish: Globe,
  /** Take it back down. */
  unpublish: EyeOff,
  /** Earlier versions of something. */
  history: History,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden="true" className={className} strokeWidth={1.75} />;
}

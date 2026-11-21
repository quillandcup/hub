import Icon, { type IconName } from "@/components/Icon";
import Tooltip from "@/components/Tooltip";
import { nextVisibility, type Visibility } from "@/lib/writing-visibility";

/**
 * Who can see a writing project or goal, as one control: a click moves it private -> community -> public -> private.
 * Lock = only me, house = other signed-in members, globe = open to the internet (the same lock and globe as everywhere,
 * `.claude/rules/icons.md`). Nothing public exists yet: that level is saved for the public profile that is coming, and
 * the tooltip says so. Reuse it wherever a writer's own work gets a visibility (books and awards later).
 */

const ICON: Record<Visibility, IconName> = { private: "unpublish", community: "community", public: "publish" };
const SHORT: Record<Visibility, string> = { private: "Only me", community: "Other members", public: "Everyone" };

/** The sentence for a level and what a click does, in the words for a "goal", a "project" or whatever the noun is. */
export function visibilityLabel(visibility: Visibility, noun: string): string {
  const withProject = noun === "goal" ? ", with its project" : noun === "project" ? ", with its goals" : "";
  const said = {
    private: `Only you can see this ${noun}.`,
    community: `Other members can see this ${noun} on your profile${noun === "goal" ? ", with its project" : ""}.`,
    public: `Shown to everyone on the internet once you have a public profile (coming soon). Until then, other members can see it on your profile${noun === "goal" ? ", with its project" : ""}.`,
  }[visibility];
  const next = nextVisibility(visibility);
  const click = {
    private: `Click to make it private${noun === "project" ? " (its goals are hidden with it)" : ""}.`,
    community: `Click to show it to other members${withProject}.`,
    public: `Click to open it to everyone on the internet${withProject}, for your upcoming public profile.`,
  }[next];
  return `${said} ${click}`;
}

export default function VisibilityControl({
  visibility,
  onChange,
  disabled,
  className = "",
  noun = "goal",
  withText = false,
  levels,
  describe,
}: {
  visibility: Visibility;
  /** Called with the level a click moves to; the caller saves it and shows the result. */
  onChange: (next: Visibility) => void;
  disabled?: boolean;
  className?: string;
  noun?: string;
  withText?: boolean;
  /** The levels a click cycles through, in order; all three by default. An item the internet cannot see leaves out "public". */
  levels?: readonly Visibility[];
  /** The tooltip, for an item whose words differ from a project's (a profile item); `next` is where a click goes. */
  describe?: (visibility: Visibility, next: Visibility) => string;
}) {
  const next = nextVisibility(visibility, levels);
  return (
    <Tooltip content={describe ? describe(visibility, next) : visibilityLabel(visibility, noun)}>
      <button data-track="visibility-control-cycle"
        type="button"
        onClick={() => onChange(next)}
        disabled={disabled}
        aria-label={`Who can see this ${noun}: ${SHORT[visibility]}`}
        className={withText ? `flex items-center gap-1.5 disabled:opacity-50 ${className}` : `flex-shrink-0 text-lg leading-none disabled:opacity-50 ${className}`}
      >
        <Icon name={ICON[visibility]} className="h-5 w-5" />
        {withText && <span className="whitespace-nowrap">{SHORT[visibility]}</span>}
      </button>
    </Tooltip>
  );
}

import Icon from "@/components/Icon";
import Tooltip from "@/components/Tooltip";

// Icon toggles for the two independent per-item settings on writing projects and goals:
// the star pins a goal to the member's own dashboard (only they see it), and the lock/globe
// controls whether other members can see it on their profile. The same icons label the
// matching checkboxes in the goal form, so the row icons are learnable.

export const STAR_ON = "⭐";
export const STAR_OFF = "☆";

interface ToggleProps {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

const buttonClass = "flex-shrink-0 text-lg leading-none disabled:opacity-50";

export function StarToggle({ on, onToggle, disabled, className = "" }: ToggleProps) {
  const label = on ? "Pinned to your dashboard (click to unpin)" : "Pin to my dashboard";
  return (
    <Tooltip content={label}>
      <button data-track="visibility-toggles-pin-to-my-dashboard"
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label="Pin to my dashboard"
        aria-pressed={on}
        className={`${buttonClass} ${className}`}
      >
        {on ? STAR_ON : STAR_OFF}
      </button>
    </Tooltip>
  );
}

export function ProfileVisibilityToggle({
  on,
  onToggle,
  disabled,
  className = "",
  noun = "goal",
  withText = false,
}: ToggleProps & { noun?: string; withText?: boolean }) {
  const label = on
    ? noun === "goal"
      ? `Visible on your profile to other members, with its project (click to hide)`
      : noun === "project"
        ? `Visible on your profile to other members (click to hide it and its goals)`
        : `Visible on your profile to other members (click to hide)`
    : noun === "goal"
      ? `Only you can see this goal (click to show it on your profile, with its project)`
      : `Only you can see this ${noun} (click to show on your profile)`;
  return (
    <Tooltip content={label}>
      <button data-track="visibility-toggles-show-on-my-profile"
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label="Show on my profile"
        aria-pressed={on}
        className={withText ? `flex items-center gap-1.5 disabled:opacity-50 ${className}` : `${buttonClass} ${className}`}
      >
        <Icon name={on ? "publish" : "unpublish"} className="h-5 w-5" />
        {withText && <span>{on ? "On my profile" : "Only me"}</span>}
      </button>
    </Tooltip>
  );
}

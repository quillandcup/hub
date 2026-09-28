// Icon toggles for the two independent per-item settings on writing projects and goals:
// the star pins a goal to the member's own dashboard (only they see it), and the lock/globe
// controls whether other members can see it on their profile. The same icons label the
// matching checkboxes in the goal form, so the row icons are learnable.

export const STAR_ON = "⭐";
export const STAR_OFF = "☆";
export const PROFILE_PUBLIC = "🌐";
export const PROFILE_PRIVATE = "🔒";

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
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={label}
      aria-label="Pin to my dashboard"
      aria-pressed={on}
      className={`${buttonClass} ${className}`}
    >
      {on ? STAR_ON : STAR_OFF}
    </button>
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
    ? `Visible on your profile to other members (click to hide)`
    : `Only you can see this ${noun} (click to show on your profile)`;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={label}
      aria-label="Show on my profile"
      aria-pressed={on}
      className={withText ? `flex items-center gap-1.5 disabled:opacity-50 ${className}` : `${buttonClass} ${className}`}
    >
      <span className={withText ? "text-base leading-none" : undefined}>{on ? PROFILE_PUBLIC : PROFILE_PRIVATE}</span>
      {withText && <span>{on ? "On my profile" : "Only me"}</span>}
    </button>
  );
}

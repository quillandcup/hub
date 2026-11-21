import Tooltip from "@/components/Tooltip";

// The star pins a goal to the member's own dashboard (only they see it). Who else can see a project or goal is
// a separate setting, `VisibilityControl` (lock, house, globe).

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

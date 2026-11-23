"use client";

import { useConfirm } from "@/components/ConfirmDialog";
import Icon from "@/components/Icon";
import { lifecycleConfirm, lifecycleIcon, lifecycleLabel, type LifecycleAction, type LifecycleContext } from "@/lib/lifecycle-actions";
import Tooltip from "@/components/Tooltip";

/**
 * One lifecycle action (`src/lib/lifecycle-actions.ts`: publish, unpublish, duplicate, delete, reset, restore, history, preview)
 * as a control: the registry's icon and label, and its confirmation when the action has one, asked before `onRun`.
 *
 * - `variant="icon"` is icon-only: the label is its accessible name and tooltip (`title`). The confirm, not a visible label,
 *   is what guards a destructive one.
 * - `variant="text"` shows the label (and the icon with `withIcon`). `label` overrides the text only where a place needs a
 *   longer one ("Publish changes"); the confirmation and icon stay the registry's.
 * - Styling comes from `className`: lists and headers have their own button looks.
 */
export default function LifecycleButton({
  action,
  noun,
  title,
  detail,
  permanent,
  onRun,
  variant = "text",
  withIcon = false,
  label,
  disabled = false,
  disabledReason,
  className,
  track,
}: LifecycleContext & {
  action: LifecycleAction;
  onRun: () => void;
  variant?: "icon" | "text";
  withIcon?: boolean;
  label?: string;
  disabled?: boolean;
  /** Why it is off, shown as the tooltip while `disabled` (an icon button keeps its name as the tooltip otherwise). */
  disabledReason?: string;
  className?: string;
  /** Value for `data-track`. */
  track?: string;
}) {
  const { ask, dialog } = useConfirm();
  const name = lifecycleLabel(action, noun);
  const shown = label ?? name;
  const icon = variant === "icon" || withIcon;

  async function click() {
    const spec = lifecycleConfirm(action, { noun, title, detail, permanent });
    if (spec && !(await ask(spec))) return;
    onRun();
  }

  return (
    <>
      <Tooltip content={disabled && disabledReason ? disabledReason : variant === "icon" ? name : undefined}>
        <button
          type="button"
          aria-label={variant === "icon" ? name : undefined}
          disabled={disabled}
          className={className}
          data-track={track}
          onClick={() => void click()}
        >
          {icon && <Icon name={lifecycleIcon(action)} className={variant === "icon" ? "h-4 w-4" : "mr-1.5 inline h-4 w-4 align-text-bottom"} />}
          {variant === "text" && shown}
        </button>
      </Tooltip>
      {dialog}
    </>
  );
}

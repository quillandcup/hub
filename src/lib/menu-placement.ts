export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MenuPlacement {
  /** Viewport x of the panel's left edge. */
  left: number;
  /** Viewport y of the panel's top edge. */
  top: number;
  /** Opens upward (above the trigger) because there is no room below. */
  above: boolean;
  /** The panel is never wider than the viewport minus its margins. */
  maxWidth: number;
}

/**
 * Where a dropdown panel goes so it stays inside the viewport: right-aligned to the trigger when it
 * fits (the usual look), else left-aligned, else clamped to the viewport edges; below the trigger
 * unless that clips and there is room above. Pure, so it can be tested without a layout engine.
 */
export function placeMenu(trigger: Box, panel: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8, gap = 4): MenuPlacement {
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(panel.width, maxWidth);
  let left: number;
  if (trigger.right - width >= margin) left = trigger.right - width;
  else if (trigger.left + width <= viewport.width - margin) left = trigger.left;
  else left = Math.min(Math.max(trigger.left, margin), viewport.width - margin - width);
  const fitsBelow = trigger.bottom + gap + panel.height + margin <= viewport.height;
  const fitsAbove = trigger.top - gap - panel.height - margin >= 0;
  const above = !fitsBelow && fitsAbove;
  return { left, top: above ? trigger.top - gap - panel.height : trigger.bottom + gap, above, maxWidth };
}

/** The view of a pan/zoom canvas: content scaled by `scale`, then moved by (x, y) pixels from the container's top-left. */
export interface PanZoomView {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 2.5;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The view that shows all of a `content` sized canvas in a `container`, centred, never enlarged past 1. */
export function fitView(container: { width: number; height: number }, content: { width: number; height: number }): PanZoomView {
  const scale = clampScale(Math.min(1, container.width / content.width, container.height / content.height));
  return {
    scale,
    x: (container.width - content.width * scale) / 2,
    y: (container.height - content.height * scale) / 2,
  };
}

/** Zoom by `factor` keeping the content point under (cx, cy), in container pixels, where it is. */
export function zoomAt(view: PanZoomView, factor: number, cx: number, cy: number): PanZoomView {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return { scale, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

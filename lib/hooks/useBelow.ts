import { useLayoutEffect, useState } from "react";

/**
 * Where the list goes: under the input, in the window's coordinates. The list is drawn on `<body>`, not
 * inside the picker, so a modal's `overflow-hidden` or a scrolling panel can't cut it off; it follows the
 * input while the page scrolls or resizes.
 */
export function useBelow(element: React.RefObject<HTMLElement | null>, active: boolean) {
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const place = () => {
      const r = element.current?.getBoundingClientRect();
      if (r) setBox({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [element, active]);
  return box;
}

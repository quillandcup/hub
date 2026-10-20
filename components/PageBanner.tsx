import type { ReactNode } from "react";

/**
 * A notice for the page being viewed, in the same strip as the notification banners under the
 * header (plum, full width). For a state of the page ("you're previewing"), not an event: it isn't a
 * notification and isn't stored. Put it first in a page, outside the page's own padded container.
 */
export default function PageBanner({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="border-b border-plum-700 bg-plum-600 px-6 py-2 text-sm text-white">
      {children}
    </div>
  );
}

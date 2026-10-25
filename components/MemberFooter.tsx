"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SUPPORT_EMAIL } from "@/lib/config";

/**
 * The member area's footer: one quiet line under the page. Deliberately minimal: Privacy (once the page is on
 * for the member, since it redirects otherwise) and a way to reach us. Not in chat, which fills the window like
 * an app and links Privacy from its own sidebar.
 */
export default function MemberFooter({ showPrivacy }: { showPrivacy: boolean }) {
  const pathname = usePathname();
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return null;

  const link = "text-slate-600 underline-offset-2 hover:text-plum-700 hover:underline dark:text-slate-400 dark:hover:text-plum-300";
  return (
    <footer className="shrink-0 border-t border-slate-200 px-6 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
      <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {showPrivacy && (
          <Link data-track="footer-privacy" href="/privacy" className={link}>
            Privacy
          </Link>
        )}
        <a data-track="footer-contact" href={`mailto:${SUPPORT_EMAIL}`} className={link}>
          Contact us
        </a>
      </nav>
    </footer>
  );
}

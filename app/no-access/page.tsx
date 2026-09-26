import type { Metadata } from "next";
import Link from "next/link";
import SignOutButton from "@/components/SignOutButton";

export const metadata: Metadata = {
  title: "No access",
};

// Where signed-in non-admins land from /admin (proxy.ts and requireAdminPage(); see
// lib/admin-paths.ts). It sits outside both route groups and must never redirect a signed-in
// user: member pages send anyone without a member record to /admin, so any redirect here could
// restart the /admin loop this page exists to end. Signed-out visitors are sent to /login by
// the proxy before reaching it.
export default function NoAccessPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">
          This area is for Quill &amp; Cup staff
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          Your account doesn&apos;t have access to the admin pages.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors mb-6"
        >
          Go to your dashboard
        </Link>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Think you should have a membership? Email{" "}
          <a href="mailto:support@quillandcup.com" className="text-blue-600 dark:text-blue-400 hover:underline">
            support@quillandcup.com
          </a>{" "}
          and we&apos;ll sort it out.
        </p>
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 text-left">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}

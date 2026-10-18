import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import TestNotifications from "./TestNotifications";

export const metadata: Metadata = {
  title: "Test Notifications",
};

export default async function TestNotificationsPage() {
  await requireAdminPage();

  return (
    <div className="container mx-auto space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Test Notifications</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Send yourself any notification on any channel, to see what members get without waiting for it to be due.
        </p>
      </div>
      <TestNotifications />
    </div>
  );
}

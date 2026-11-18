import type { Metadata } from "next";
import { redirect } from "next/navigation";
import GateExit from "@/components/GateExit";
import MfaChallengeForm from "@/components/mfa/MfaChallengeForm";
import MfaPanel from "@/components/mfa/MfaPanel";
import { getCurrentUser } from "@/lib/auth";
import { SUPPORT_EMAIL } from "@/lib/config";
import { GATES, afterGate, returnToParam } from "@/lib/gates";
import { createClient } from "@/lib/supabase/server";
import { readMfaStatus } from "@/lib/staff-mfa.server";

export const metadata: Metadata = {
  title: "Two-step sign-in",
};

const HOME = "/admin";

// The gate for staff accounts (GATES.staffMfa; proxy.ts and requireAdminPage() send staff here): type the code from the
// authenticator app, or set it up first when the account has none. It sits outside both route groups, like /no-access, so it
// never depends on a member record. Once the session has passed the second step it goes to where the visitor was headed.
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const next = afterGate(GATES.staffMfa, returnToParam((await searchParams).next), HOME);
  const status = await readMfaStatus(await createClient());
  if (status.aal2) redirect(next);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-lg bg-white p-8 shadow dark:bg-slate-900">
        <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          {status.hasFactor ? "Enter your sign-in code" : "Set up two-step sign-in"}
        </h1>
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">{GATES.staffMfa.reason}</p>
        {status.hasFactor ? <MfaChallengeForm next={next} helpEmail={SUPPORT_EMAIL} /> : <MfaPanel afterEnrol={next} staff />}
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <GateExit gate={GATES.staffMfa} />
        </div>
      </div>
    </div>
  );
}

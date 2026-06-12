import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MissingMemberDataPage() {
  const supabase = await createClient();

  const { data: missingStripe } = await supabase
    .from("members")
    .select("id, name, email, kajabi_id")
    .eq("status", "active")
    .is("stripe_customer_id", null)
    .order("name");

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href="/admin/hygiene"
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Data Hygiene Dashboard
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          Missing Member Data
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          Active members with incomplete external account linkage.
        </p>

        <div className="space-y-8">
          {/* Missing Stripe ID */}
          <section className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Missing Stripe Customer ID
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Active members with no match in{" "}
                  <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                    bronze.stripe_customers
                  </code>
                  . Re-run{" "}
                  <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                    /api/process/members
                  </code>{" "}
                  after importing fresh Stripe data to resolve matched members.
                </p>
              </div>
              <span className={`text-2xl font-bold ${(missingStripe?.length ?? 0) > 0 ? "text-orange-500" : "text-green-500"}`}>
                {missingStripe?.length ?? 0}
              </span>
            </div>
            {missingStripe && missingStripe.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Kajabi
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {missingStripe.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                        <td className="px-6 py-3">
                          <Link
                            href={`/admin/members/${member.id}`}
                            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                          >
                            {member.name}
                          </Link>
                        </td>
                        <td className="px-6 py-3 text-sm text-slate-600 dark:text-slate-400">
                          {member.email}
                        </td>
                        <td className="px-6 py-3">
                          {member.kajabi_id ? (
                            <a
                              href={`https://app.kajabi.com/admin/contacts/${member.kajabi_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {member.kajabi_id}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-8 text-center text-sm text-green-600 dark:text-green-400 font-medium">
                All active members have a Stripe customer ID.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

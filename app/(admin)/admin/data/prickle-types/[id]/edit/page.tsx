import { cache } from "react";
import RecordHistoryButton from "@/components/RecordHistoryButton";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import EditPrickleTypeForm from "./EditPrickleTypeForm";
import { requireAdminPage } from "@/lib/admin-auth";
import type { PrickleTypePurpose } from "@/lib/prickle-picker";
import { createRepos } from "@/lib/data/repos";

const getPrickleType = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prickle_types")
    .select("id, name, normalized_name, description, purpose, solo_task_friendly, listed_in_events, announced_publicly, guests_allowed, default_host_id, summary_aliases, names_guest_speaker")
    .eq("id", id)
    .single();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const prickleType = await getPrickleType(id);
  return { title: prickleType?.name ? `Edit ${prickleType.name}` : "Edit Prickle Type" };
}

export default async function EditPrickleTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch the prickle type by ID
  const prickleType = await getPrickleType(id);

  if (!prickleType) {
    redirect("/data/prickle-types");
  }

  const members = (await createRepos(await createClient()).members.list({ status: "active", orderBy: "name" })).map(({ id, name, email }) => ({ id, name, email }));
  // The default host may no longer be active; still show who it is
  const defaultHostName = prickleType.default_host_id
    ? (members.find((m) => m.id === prickleType.default_host_id)?.name ??
      (await createRepos(await createClient()).members.byIds([prickleType.default_host_id]))[0]?.name ??
      null)
    : null;

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 relative">
          <Link
            href="/data/prickle-types"
            className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block"
          >
            ← Back to Prickle Types
          </Link>
          <h1 className="text-2xl font-bold">Edit Prickle Type</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Update the name and description of this prickle type
          </p>
          <div className="absolute top-4 right-6">
            <RecordHistoryButton
              entityType={["prickle_type", "prickle_schedule", "prickle_host_vibe"]}
              entityId={prickleType.id}
              parentColumn="type_id"
              label={prickleType.name}
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl">
          <EditPrickleTypeForm
            prickleType={{ ...prickleType, purpose: prickleType.purpose as PrickleTypePurpose }}
            members={members}
            defaultHostName={defaultHostName}
          />
        </div>
      </main>
    </div>
  );
}

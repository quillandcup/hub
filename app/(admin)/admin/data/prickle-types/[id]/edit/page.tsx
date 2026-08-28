import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import EditPrickleTypeForm from "./EditPrickleTypeForm";

const getPrickleType = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prickle_types")
    .select("id, name, normalized_name, description, purpose, solo_task_friendly")
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
  const supabase = await createClient();
  const { id } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch the prickle type by ID
  const prickleType = await getPrickleType(id);

  if (!prickleType) {
    redirect("/data/prickle-types");
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/data/prickle-types"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Prickle Types
          </Link>
          <h1 className="text-2xl font-bold">Edit Prickle Type</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Update the name and description of this prickle type
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl">
          <EditPrickleTypeForm prickleType={prickleType} />
        </div>
      </main>
    </div>
  );
}

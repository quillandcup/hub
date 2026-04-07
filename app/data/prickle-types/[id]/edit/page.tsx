import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import EditPrickleTypeForm from "./EditPrickleTypeForm";

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
  const { data: prickleType, error } = await supabase
    .from("prickle_types")
    .select("id, name, normalized_name, description")
    .eq("id", id)
    .single();

  if (error || !prickleType) {
    redirect("/dashboard/prickle-types");
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/dashboard/prickle-types"
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

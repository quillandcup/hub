import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import NewPageForm from "./NewPageForm";

export const metadata: Metadata = { title: "New page · Pages" };

export default async function NewLandingPage() {
  await requireAdminPage();
  return (
    <div className="container mx-auto max-w-xl px-6 py-8">
      <h1 className="mb-6 text-3xl font-bold">New page</h1>
      <NewPageForm />
    </div>
  );
}

import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { aiConfigured } from "@/lib/landing/ai";
import NewPageForm from "./NewPageForm";

export const metadata: Metadata = { title: "New page · Pages" };

/** "Build with AI" calls the Claude API from the form's action, which can take a minute or two. */
export const maxDuration = 120;

export default async function NewLandingPage() {
  await requireAdminPage();
  return (
    <div className="container mx-auto max-w-xl px-6 py-8">
      <h1 className="mb-6 text-3xl font-bold">New page</h1>
      <NewPageForm aiAvailable={aiConfigured()} />
    </div>
  );
}

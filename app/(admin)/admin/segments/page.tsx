import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";

// Segments now live on the Previews page; this keeps old links and bookmarks working.
export default async function SegmentsPage() {
  await requireAdminPage();
  redirect("/admin/previews");
}

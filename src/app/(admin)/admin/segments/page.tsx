import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin-auth";

// Segments now live on the Previews page; this keeps old links and bookmarks working.
export default async function SegmentsPage() {
  await requirePermission("system.previews.manage");
  redirect("/admin/previews");
}

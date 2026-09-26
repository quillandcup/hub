import type { Metadata } from "next";
import SegmentsClient from "./SegmentsClient";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Segments",
};

export default async function SegmentsPage() {
  await requireAdminPage();
  return <SegmentsClient />;
}

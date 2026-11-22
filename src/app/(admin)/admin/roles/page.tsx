import type { Metadata } from "next";
import { requirePermission } from "@/lib/admin-auth";
import { buildPermissionMatrix } from "@/lib/permission-matrix";
import RolesClient from "./RolesClient";

export const metadata: Metadata = {
  title: "Roles",
};

/** Every staff role and permission, generated from the registry in `src/lib/permissions.ts` (read-only: roles live in code). */
export default async function RolesPage() {
  await requirePermission("roles.read");
  return <RolesClient matrix={buildPermissionMatrix()} />;
}

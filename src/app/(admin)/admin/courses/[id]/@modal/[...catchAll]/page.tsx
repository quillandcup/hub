import { requireAdminPage } from "@/lib/admin-auth";

/** Any other route under the course closes the modal: the slot would otherwise keep showing it. */
export default async function CloseModal() {
  await requireAdminPage();
  return null;
}

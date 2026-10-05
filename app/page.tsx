import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

// Everyone lands on the member dashboard, admins included. An admin with no member record is
// sent on to /admin by the dashboard itself.
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}

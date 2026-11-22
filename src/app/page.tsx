import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import RootHomepage from "@/components/site/RootHomepage";
import { isRootHost } from "@/lib/root-routing";

// On the public site's root host (quillandcup.com) this is the public homepage, for everyone: nobody is signed in on that host.
// On the app host everyone lands on the member dashboard, admins included. An admin with no member record is
// sent on to /admin by the dashboard itself.
export default async function Home() {
  if (isRootHost((await headers()).get("host"))) return <RootHomepage />;
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import RootHomepage from "@/components/site/RootHomepage";
import { SITE_URL } from "@/lib/config";
import { HOME_SLUG, publicLandingElement, landingPageMetadata, loadPublishedLandingPage } from "@/lib/landing/public-page";
import { isRootHost } from "@/lib/root-routing";

/** The published landing page with slug `home`, when this is the root host and there is one (never a draft); otherwise null. */
async function homePage() {
  if (!isRootHost((await headers()).get("host"))) return null;
  return loadPublishedLandingPage(HOME_SLUG).catch(() => null);
}

/** On the root host: the home page's own title, description and social card, with `/` as its one address; else the plain front page's. */
export async function generateMetadata(): Promise<Metadata> {
  if (!isRootHost((await headers()).get("host"))) return {};
  const page = await homePage();
  if (page) return landingPageMetadata(page, `${SITE_URL}/`, SITE_URL);
  return { title: { absolute: "Quill & Cup" }, description: "A community of writers who show up, write together and finish their books." };
}

// On the public site's root host (quillandcup.com) this is the public homepage, for everyone: nobody is signed in on that host.
// It is the published landing page with slug `home` (built at /admin/pages/home, same renderer as /p/<slug>); with none published
// (never made, a draft, taken down, or the read failed) the plain RootHomepage, so the site is never blank.
// On the app host everyone lands on the member dashboard, admins included. An admin with no member record is
// sent on to /admin by the dashboard itself.
export default async function Home() {
  if (isRootHost((await headers()).get("host"))) {
    const page = await homePage();
    return page ? await publicLandingElement(page) : <RootHomepage />;
  }
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}

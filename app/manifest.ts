import type { MetadataRoute } from "next";
import appConfig from "@/app.config";

/**
 * Makes "Add to Home Screen" install the Hub as an app that opens full-screen. iOS only allows web
 * push (the Browser notification channel, lib/channels/web-push.ts) from such an installed app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.appName,
    short_name: appConfig.appName,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [{ src: "/billiebot.png", sizes: "1000x1000", type: "image/png", purpose: "any" }],
  };
}

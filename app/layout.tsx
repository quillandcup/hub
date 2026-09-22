import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "./providers/ThemeProvider";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { EnvironmentIndicator } from "@/components/EnvironmentIndicator";
import { ConsentBanner } from "@/components/ConsentBanner";
import { countryNeedsConsent } from "@/lib/gdpr-countries";

export const metadata: Metadata = {
  title: {
    default: "Hedgie Hub",
    template: "%s | Hedgie Hub",
  },
  description: "Attendance and engagement analytics for Quill & Cup writing sessions",
  icons: {
    icon: '/icon.png',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  // Vercel's edge geolocation header -- see lib/gdpr-countries.ts. Missing
  // (e.g. local dev, non-Vercel hosting) is treated as "needs consent" to
  // fail closed rather than silently track visitors we can't place.
  const headersList = await headers();
  const needsConsent = countryNeedsConsent(headersList.get("x-vercel-ip-country"));

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <EnvironmentIndicator />
          {children}
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
        {gaId && (
          <>
            {/*
              Google Consent Mode v2: this MUST run before gtag.js loads/configures
              (hence strategy="beforeInteractive", and placed before <GoogleAnalytics>
              which defaults to "afterInteractive"). EU/EEA/UK visitors start denied
              until they accept the banner below; everyone else starts granted.
            */}
            <Script id="ga-consent-default" strategy="beforeInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  analytics_storage: '${needsConsent ? "denied" : "granted"}',
  ad_storage: '${needsConsent ? "denied" : "granted"}'
});`}
            </Script>
            <GoogleAnalytics gaId={gaId} />
            <ConsentBanner needsConsent={needsConsent} />
          </>
        )}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quill & Cup Admin Portal",
  description: "Attendance and engagement analytics for Quill & Cup writing sessions",
  icons: {
    icon: '/icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

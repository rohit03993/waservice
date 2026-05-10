import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "WhatsApp CRM",
  description: "WhatsApp messaging CRM — contacts, campaigns, inbox"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

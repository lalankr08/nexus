"use client";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="max-w-2xl mx-auto p-8 md:p-16">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
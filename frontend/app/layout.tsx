"use client";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

// wrapper so next-auth doesn't cry
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-zinc-900 min-h-screen">
        <SessionProvider>
          <div className="max-w-5xl mx-auto p-6 md:py-10">{children}</div>
        </SessionProvider>
      </body>
    </html>
  );
}
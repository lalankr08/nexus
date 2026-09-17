"use client";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-white">
      <body className="w-full min-h-screen bg-white text-zinc-900 antialiased">
        <SessionProvider>
          <div className="w-full max-w-5xl mx-auto px-6 py-10 md:py-12">
            {children}
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function Home() {
  const { data: session } = useSession();

  return (
    <main className="space-y-10">
      <header className="border-b border-zinc-200 pb-4">
        <h1 className="text-2xl font-medium tracking-tight">Nexus</h1>
        <p className="text-zinc-500 text-sm mt-1">Autonomous Career Intelligence Agent</p>
      </header>

      <section>
        {session ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm">Logged in as <span className="font-medium">{session.user?.email}</span></p>
              <button 
                onClick={() => signOut()} 
                className="text-sm text-zinc-500 hover:text-zinc-900 underline underline-offset-2"
              >
                Log out
              </button>
            </div>

            <div className="p-6 border border-zinc-200 bg-white rounded-md shadow-sm space-y-4">
              <h2 className="font-medium text-lg">Match Resume</h2>
              <p className="text-sm text-zinc-500">Upload your PDF resume to find semantic matches in your database.</p>
              
              <input 
                type="file" 
                accept="application/pdf"
                className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:border file:border-zinc-200 file:bg-zinc-50 file:rounded-md file:text-sm hover:file:bg-zinc-100 cursor-pointer"
              />
              
              <button className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-md hover:bg-zinc-800 transition-colors">
                Run Semantic Search
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-zinc-600">Please authenticate to access your private job shortlist.</p>
            <div className="flex gap-3">
              <button 
                onClick={() => signIn("google")} 
                className="px-4 py-2 text-sm border border-zinc-200 rounded-md hover:bg-zinc-50 transition-colors"
              >
                Continue with Google
              </button>
              <button 
                onClick={() => signIn("github")} 
                className="px-4 py-2 text-sm border border-zinc-200 rounded-md hover:bg-zinc-50 transition-colors"
              >
                Continue with GitHub
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
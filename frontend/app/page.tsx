"use client";
import { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface JobMatch {
  id: number;
  title: string;
  company: string;
  loc?: string;
  url: string;
  score?: number;
  matchScore?: number;
  just: string;
}

export default function Page() {
  const { data: session, status } = useSession();
  const [results, setResults] = useState<JobMatch[]>([]);
  const [loading, setLoading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/api/match", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      
      const data = await res.json();
      setResults(data.matches || []);
    } catch (err) {
      console.error(err);
      alert("Error processing PDF. check backend on port 8000.");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-zinc-500 animate-pulse text-lg font-medium">Authenticating...</p>
      </div>
    );
  }

  // 2. Unauthenticated State (Login Screen)
  if (status === "unauthenticated") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <div className="max-w-md w-full space-y-8 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight">Nexus</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Autonomous career intelligence. Upload your resume and find semantic job matches.
          </p>
          <button
            onClick={() => signIn()}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors shadow-sm"
          >
            Sign In with GitHub / Google
          </button>
        </div>
      </main>
    );
  }

  // 3. Authenticated State (Dashboard)
  return (
    <main className="min-h-screen p-8 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 pb-6 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Nexus Dashboard</h1>
            <p className="text-sm text-zinc-500 mt-1">Logged in as {session?.user?.email}</p>
          </div>
          <button
            onClick={() => signOut()}
            className="mt-4 sm:mt-0 px-4 py-2 text-sm font-medium bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-md transition-colors"
          >
            Sign Out
          </button>
        </header>

        {/* Upload Section */}
        <div className="mb-10 bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Analyze Resume</h2>
          <input 
            type="file" 
            accept="application/pdf" 
            onChange={handleUpload}
            disabled={loading}
            className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 cursor-pointer transition-colors"
          />
          {loading && (
            <p className="mt-4 text-sm font-medium animate-pulse text-blue-600 dark:text-blue-400">
              Generating vector embeddings and calculating semantic matches...
            </p>
          )}
        </div>

        {/* Results Table */}
        {results.length > 0 && (
          <div className="overflow-hidden border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm bg-white dark:bg-zinc-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead className="bg-zinc-100 dark:bg-zinc-950">
                  <tr>
                    <th className="p-4 font-semibold text-sm">Match</th>
                    <th className="p-4 font-semibold text-sm">Role</th>
                    <th className="p-4 font-semibold text-sm">Company</th>
                    <th className="p-4 font-semibold text-sm">Location</th>
                    <th className="p-4 font-semibold text-sm">Why it fits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {results.map((job) => (
                    <tr key={job.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="p-4 font-bold text-blue-600 dark:text-blue-400">
                        {Math.round((job.matchScore ?? job.score ?? 0) * 100)}%
                      </td>
                      <td className="p-4 font-medium">
                        {job.url ? (
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {job.title}
                          </a>
                        ) : (
                          job.title
                        )}
                      </td>
                      <td className="p-4 text-zinc-600 dark:text-zinc-300">{job.company}</td>
                      <td className="p-4 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{job.loc || "Not specified"}</td>
                      <td className="p-4 text-sm text-zinc-500 dark:text-zinc-400 min-w-[300px]">
                        {job.just}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
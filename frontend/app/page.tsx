"use client";

import { useState, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface MatchItem {
  id: number;
  title: string;
  company: string;
  loc?: string;
  url: string;
  matchScore: number;
  just: string;
}

interface JobItem {
  id: number;
  title: string;
  company: string;
  loc?: string;
  srcUrl: string;
  skills?: string[];
}

export default function Page() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<"match" | "jobs">("match");
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [syncMsg, setSyncMsg] = useState("");

  // Fetch jobs on mount
  useEffect(() => {
    let active = true;
    fetch("/api/py/jobs")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.jobs) setJobs(data.jobs);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  // Upload and analyze PDF resume
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setErrMsg("");
    setMatches([]);
    setLoading(true);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/py/match", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || data?.error) {
        throw new Error(data?.error || "Failed to analyze resume. Please try another PDF.");
      }

      setMatches(data.matches || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error analyzing resume.";
      setErrMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // Trigger scraper and extract pipeline in background
  const handleSync = async () => {
    setSyncMsg("Starting sync...");
    try {
      const res = await fetch("/api/py/sync", { method: "POST" });
      if (res.ok) {
        setSyncMsg("Syncing jobs in background...");
        setTimeout(() => setSyncMsg(""), 4000);
      }
    } catch {
      setSyncMsg("Sync failed");
      setTimeout(() => setSyncMsg(""), 3000);
    }
  };

  return (
    <main className="space-y-6">
      {/* Header */}
      <header className="border-b border-zinc-200 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Nexus</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Autonomous career intelligence &amp; semantic job matching
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSync}
            className="px-3 py-1.5 text-xs border border-zinc-200 rounded-md hover:bg-zinc-100"
          >
            Sync Jobs
          </button>
          {session ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{session.user?.email}</span>
              <button
                onClick={() => signOut()}
                className="text-xs text-zinc-600 hover:text-zinc-900 underline"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => signIn()}
              className="px-3 py-1.5 text-xs bg-zinc-900 text-white rounded-md hover:bg-zinc-800"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {syncMsg && <p className="text-xs text-blue-600 font-medium">{syncMsg}</p>}

      {/* Tabs */}
      <nav className="flex gap-2 border-b border-zinc-200 pb-2 text-sm">
        <button
          onClick={() => setTab("match")}
          className={`px-3 py-1.5 rounded-md ${
            tab === "match"
              ? "bg-zinc-900 text-white"
              : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          Match Resume {matches.length > 0 && `(${matches.length})`}
        </button>
        <button
          onClick={() => setTab("jobs")}
          className={`px-3 py-1.5 rounded-md ${
            tab === "jobs"
              ? "bg-zinc-900 text-white"
              : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          Browse Jobs ({jobs.length})
        </button>
      </nav>

      {/* Tab: Match Resume */}
      {tab === "match" && (
        <section className="space-y-6">
          <div className="p-5 border border-zinc-200 bg-white rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium text-zinc-900">Upload Resume (PDF)</h2>
              {fileName && (
                <span className="text-xs text-zinc-500 font-mono bg-zinc-100 px-2 py-0.5 rounded">
                  {fileName}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Upload your PDF resume to generate embeddings and find semantic matches in your database.
            </p>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleUpload}
              disabled={loading}
              className="block w-full text-sm text-zinc-500 file:mr-3 file:py-1.5 file:px-3 file:border file:border-zinc-200 file:rounded-md file:bg-zinc-50 file:text-xs hover:file:bg-zinc-100 cursor-pointer"
            />
            {loading && (
              <p className="text-xs text-blue-600 animate-pulse font-medium">
                Reading PDF, generating vector embeddings, and ranking listings...
              </p>
            )}
            {errMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {errMsg}
              </div>
            )}
          </div>

          {/* Results: Top Matches */}
          {matches.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-800">
                Top Semantic Matches ({matches.length})
              </h3>
              <div className="space-y-3">
                {matches.map((m) => (
                  <div
                    key={m.id}
                    className="p-4 border border-zinc-200 rounded-lg bg-white space-y-2.5 hover:border-zinc-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="font-medium text-sm text-zinc-900">{m.title}</h4>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {m.company} {m.loc ? `• ${m.loc}` : ""}
                        </p>
                      </div>
                      <span className="text-xs font-semibold px-2 py-1 bg-blue-50 text-blue-700 rounded">
                        {Math.round(m.matchScore * 100)}% Match
                      </span>
                    </div>

                    {/* One-line LLM justification */}
                    <p className="text-xs text-zinc-600 bg-zinc-50 p-2.5 rounded border border-zinc-100">
                      💡 {m.just}
                    </p>

                    {/* View Listing Link */}
                    {m.url && (
                      <div className="pt-1">
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block px-3 py-1 text-xs bg-zinc-900 text-white rounded hover:bg-zinc-800"
                        >
                          View Listing ↗
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : !loading && !errMsg ? (
            <div className="p-8 border border-dashed border-zinc-200 rounded-lg text-center text-xs text-zinc-400">
              Upload your PDF resume above to see semantic job matches and justifications.
            </div>
          ) : null}
        </section>
      )}

      {/* Tab: Browse Jobs */}
      {tab === "jobs" && (
        <section className="space-y-4">
          <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                  <th className="p-3">Role</th>
                  <th className="p-3">Company</th>
                  <th className="p-3">Location</th>
                  <th className="p-3">Skills</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-zinc-50">
                    <td className="p-3 font-medium">
                      {j.srcUrl ? (
                        <a
                          href={j.srcUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline text-zinc-900"
                        >
                          {j.title}
                        </a>
                      ) : (
                        j.title
                      )}
                    </td>
                    <td className="p-3 text-zinc-600">{j.company}</td>
                    <td className="p-3 text-zinc-500 text-xs">{j.loc || "-"}</td>
                    <td className="p-3 text-xs text-zinc-500">
                      {Array.isArray(j.skills) ? j.skills.slice(0, 3).join(", ") : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
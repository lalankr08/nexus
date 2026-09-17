"use client";

import { useState, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface Job {
  id: number;
  title: string;
  company: string;
  loc?: string;
  url?: string;
  srcUrl?: string;
  matchScore?: number;
  just?: string;
  skills?: string[];
}

export default function Page() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<"match" | "jobs">("match");
  const [matches, setMatches] = useState<Job[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // grab jobs on mount
  useEffect(() => {
    fetch("/api/py/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => { });
  }, []);

  // send pdf to backend and pray it parses
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f.name);
    setErr("");
    setMatches([]);
    setLoading(true);

    const body = new FormData();
    body.append("file", f);

    try {
      const res = await fetch("/api/py/match", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "upload failed");
      setMatches(data.matches || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "something broke");
    } finally {
      setLoading(false);
    }
  };

  // trigger scraper in background
  const handleSync = async () => {
    setMsg("syncing...");
    try {
      await fetch("/api/py/sync", { method: "POST" });
      setMsg("sync started");
      setTimeout(() => setMsg(""), 3000);
    } catch {
      setMsg("sync failed :/");
    }
  };

  return (
    <main className="space-y-6">
      <header className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-xl font-bold">Nexus</h1>
          <p className="text-xs text-zinc-500">autonomous career intelligence</p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <button onClick={handleSync} className="border px-2.5 py-1 rounded hover:bg-zinc-50">
            Sync Jobs
          </button>
          {session ? (
            <>
              <span className="text-zinc-400">{session.user?.email}</span>
              <button onClick={() => signOut()} className="underline text-zinc-500">Sign out</button>
            </>
          ) : (
            <button onClick={() => signIn()} className="bg-black text-white px-3 py-1 rounded hover:opacity-85">
              Sign in
            </button>
          )}
        </div>
      </header>

      {msg && <p className="text-xs text-blue-600 font-medium">{msg}</p>}

      {/* tabs */}
      <nav className="flex gap-2 text-sm border-b pb-2">
        <button
          onClick={() => setTab("match")}
          className={`px-3 py-1 rounded ${tab === "match" ? "bg-black text-white" : "text-zinc-500 hover:bg-zinc-100"}`}
        >
          Match Resume {matches.length ? `(${matches.length})` : ""}
        </button>
        <button
          onClick={() => setTab("jobs")}
          className={`px-3 py-1 rounded ${tab === "jobs" ? "bg-black text-white" : "text-zinc-500 hover:bg-zinc-100"}`}
        >
          Browse Jobs ({jobs.length})
        </button>
      </nav>

      {/* match tab */}
      {tab === "match" && (
        <section className="space-y-4">
          <div className="p-4 border rounded-lg bg-white space-y-2">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-medium">Upload Resume (PDF)</h2>
              {file && <span className="text-xs bg-zinc-100 px-2 py-0.5 rounded font-mono">{file}</span>}
            </div>
            <p className="text-xs text-zinc-400">upload pdf to find semantic matches in database</p>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleUpload}
              disabled={loading}
              className="text-xs block w-full file:mr-2 file:py-1 file:px-2 file:border file:rounded file:bg-zinc-50 cursor-pointer"
            />
            {loading && <p className="text-xs text-blue-500 animate-pulse">reading pdf and ranking matches...</p>}
            {err && <p className="text-xs text-red-500 bg-red-50 p-2 rounded">{err}</p>}
          </div>

          {matches.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-medium text-zinc-400 uppercase">Top Matches ({matches.length})</h3>
              {matches.map((m) => (
                <div key={m.id} className="p-4 border rounded-lg bg-white space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-sm font-medium">{m.title}</h4>
                      <p className="text-xs text-zinc-400">{m.company} {m.loc ? `• ${m.loc}` : ""}</p>
                    </div>
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {Math.round((m.matchScore || 0) * 100)}% match
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600 bg-zinc-50 p-2.5 rounded border border-zinc-100">
                    {m.just}
                  </p>

                  {m.url && (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs bg-black text-white px-2.5 py-1 rounded hover:opacity-85"
                    >
                      View Listing ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* jobs tab */}
      {tab === "jobs" && (
        <section className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-50 text-zinc-400 border-b">
              <tr>
                <th className="p-3">Role</th>
                <th className="p-3">Company</th>
                <th className="p-3">Location</th>
                <th className="p-3">Skills</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-zinc-50">
                  <td className="p-3 font-medium">
                    {j.srcUrl ? (
                      <a href={j.srcUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {j.title}
                      </a>
                    ) : (
                      j.title
                    )}
                  </td>
                  <td className="p-3 text-zinc-600">{j.company}</td>
                  <td className="p-3 text-zinc-400">{j.loc || "-"}</td>
                  <td className="p-3 text-zinc-400">
                    {Array.isArray(j.skills) ? j.skills.slice(0, 3).join(", ") : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
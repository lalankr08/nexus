"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface Job {
  id: number;
  jobId?: number;
  title: string;
  company: string;
  loc?: string;
  url?: string;
  srcUrl?: string;
  matchScore?: number;
  just?: string;
  skills?: string[];
}

interface ChatMsg {
  role: "user" | "bot";
  text: string;
}

// format simple markdown bold, links, and bullet lines
function formatAgentText(text: string) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("* ");
        const content = isBullet ? trimmed.slice(2) : line;

        const parts: (string | React.ReactNode)[] = [];
        const regex = /(\[.*?\]\(.*?\)|\*\*.*?\*\*)/g;
        let lastIdx = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
          if (match.index > lastIdx) {
            parts.push(content.substring(lastIdx, match.index));
          }
          const token = match[0];
          if (token.startsWith("[") && token.includes("](")) {
            const label = token.slice(1, token.indexOf("]("));
            const url = token.slice(token.indexOf("](") + 2, -1);
            parts.push(
              <a
                key={match.index}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600 hover:text-blue-800"
              >
                {label}
              </a>
            );
          } else if (token.startsWith("**") && token.endsWith("**")) {
            parts.push(
              <strong key={match.index} className="font-semibold text-zinc-900">
                {token.slice(2, -2)}
              </strong>
            );
          }
          lastIdx = regex.lastIndex;
        }

        if (lastIdx < content.length) {
          parts.push(content.substring(lastIdx));
        }

        return (
          <div key={idx} className={isBullet ? "flex items-start gap-2 ml-1" : ""}>
            {isBullet && <span className="text-zinc-400 select-none">•</span>}
            <div className="flex-1">{parts.length > 0 ? parts : content}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Page() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<"match" | "saved" | "jobs" | "agent">("match");
  const [matches, setMatches] = useState<Job[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedList, setSavedList] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // agent chat state
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "bot", text: "Ask me anything about your saved jobs, skill trends, or deadlines." }
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === "agent") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatLoading, tab]);

  // read local storage after client mount to prevent hydration mismatch error
  useEffect(() => {
    try {
      const local = localStorage.getItem("nexus_saved");
      if (local) setSavedList(JSON.parse(local));
    } catch { }
  }, []);

  // grab jobs on mount
  useEffect(() => {
    fetch("/api/py/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => { });
  }, []);

  // sync saved list with backend when logged in
  useEffect(() => {
    const email = session?.user?.email;
    if (!email) return;

    fetch(`/api/py/shortlist?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.shortlist) {
          setSavedList(d.shortlist);
          try {
            localStorage.setItem("nexus_saved", JSON.stringify(d.shortlist));
          } catch { }
        }
      })
      .catch(() => { });
  }, [session]);

  // save or unsave a job
  const toggleSave = async (job: Job) => {
    const targetId = job.jobId || job.id;
    const exists = savedList.some((s) => (s.jobId || s.id) === targetId);

    const nextList = exists
      ? savedList.filter((s) => (s.jobId || s.id) !== targetId)
      : [...savedList, { ...job, id: targetId, jobId: targetId }];

    setSavedList(nextList);
    try {
      localStorage.setItem("nexus_saved", JSON.stringify(nextList));
    } catch { }

    const email = session?.user?.email;
    if (email) {
      try {
        await fetch("/api/py/shortlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            jobId: targetId,
            matchScore: job.matchScore || 0,
            just: job.just || "",
          }),
        });
      } catch { }
    }
  };

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

  // talk to agent using tools
  const handleSendChat = async (presetText?: string) => {
    const query = presetText || chatInput;
    if (!query.trim() || chatLoading) return;

    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/py/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          email: session?.user?.email || "",
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "bot", text: data.reply || "no response" }]);
    } catch {
      setMessages((prev) => [...prev, { role: "bot", text: "could not reach agent :/" }]);
    } finally {
      setChatLoading(false);
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
          onClick={() => setTab("saved")}
          className={`px-3 py-1 rounded ${tab === "saved" ? "bg-black text-white" : "text-zinc-500 hover:bg-zinc-100"}`}
        >
          Saved List {savedList.length ? `(${savedList.length})` : ""}
        </button>
        <button
          onClick={() => setTab("jobs")}
          className={`px-3 py-1 rounded ${tab === "jobs" ? "bg-black text-white" : "text-zinc-500 hover:bg-zinc-100"}`}
        >
          Browse Jobs ({jobs.length})
        </button>
        <button
          onClick={() => setTab("agent")}
          className={`px-3 py-1 rounded ${tab === "agent" ? "bg-black text-white" : "text-zinc-500 hover:bg-zinc-100"}`}
        >
          Agent Chat
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
              {matches.map((m) => {
                const targetId = m.jobId || m.id;
                const isSaved = savedList.some((s) => (s.jobId || s.id) === targetId);

                return (
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

                    <p className="text-xs text-zinc-600 bg-zinc-50 p-2 rounded border border-zinc-100">
                      {m.just}
                    </p>

                    <div className="pt-1 flex items-center gap-2">
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
                      <button
                        onClick={() => toggleSave(m)}
                        className={`text-xs cursor-pointer transition-colors ${isSaved ? "font-semibold text-black" : "text-zinc-400 hover:text-black"
                          }`}
                      >
                        {isSaved ? "Saved" : "Save"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* saved list tab */}
      {tab === "saved" && (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-medium">Saved Jobs ({savedList.length})</h2>
            {savedList.length > 0 && (
              <button
                onClick={() => {
                  setSavedList([]);
                  try {
                    localStorage.removeItem("nexus_saved");
                  } catch { }
                }}
                className="text-xs text-red-500 hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          {savedList.length === 0 ? (
            <div className="p-8 border border-dashed rounded-lg text-center text-xs text-zinc-400">
              no saved jobs yet. click &ldquo;Save&rdquo; on any match or catalog job.
            </div>
          ) : (
            <div className="space-y-3">
              {savedList.map((item) => (
                <div key={item.id} className="p-4 border rounded-lg bg-white space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-sm font-medium">{item.title}</h4>
                      <p className="text-xs text-zinc-400">{item.company} {item.loc ? `• ${item.loc}` : ""}</p>
                    </div>
                    {item.matchScore ? (
                      <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                        {Math.round(item.matchScore * 100)}% match
                      </span>
                    ) : null}
                  </div>

                  {item.just && (
                    <p className="text-xs text-zinc-600 bg-zinc-50 p-2 rounded">
                      {item.just}
                    </p>
                  )}

                  <div className="pt-1 flex items-center gap-2">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-xs bg-black text-white px-2.5 py-1 rounded hover:opacity-85"
                      >
                        View Listing ↗
                      </a>
                    )}
                    <button
                      onClick={() => toggleSave(item)}
                      className="text-xs text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                    >
                      Remove
                    </button>
                  </div>
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
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((j) => {
                const isSaved = savedList.some((s) => (s.jobId || s.id) === j.id);

                return (
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
                    <td className="p-3 text-right">
                      <button
                        onClick={() =>
                          toggleSave({
                            id: j.id,
                            jobId: j.id,
                            title: j.title,
                            company: j.company,
                            loc: j.loc,
                            url: j.srcUrl,
                          })
                        }
                        className={`text-xs cursor-pointer transition-colors ${isSaved ? "font-semibold text-black" : "text-zinc-400 hover:text-black"
                          }`}
                      >
                        {isSaved ? "Saved" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* agent tab */}
      {tab === "agent" && (
        <section className="space-y-4">
          <div className="border rounded-lg p-5 bg-white space-y-4">
            {/* agent top bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3.5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900">Career Intelligence Agent</h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Online
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Natural language database querying via Gemini Flash Lite tool calling.
                </p>
              </div>

              {/* clear history */}
              {messages.length > 1 && (
                <button
                  onClick={() =>
                    setMessages([
                      { role: "bot", text: "Ask me anything about your saved jobs, skill trends, or deadlines." },
                    ])
                  }
                  className="text-xs text-zinc-400 hover:text-zinc-800 transition-colors self-start sm:self-auto cursor-pointer"
                >
                  Clear history
                </button>
              )}
            </div>

            {/* active database tools banner */}
            <div className="bg-zinc-50 border border-zinc-100 rounded-md p-2.5 text-xs text-zinc-600 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-zinc-400 font-medium">Active DB Tools:</span>
                <span className="bg-white border border-zinc-200 px-2 py-0.5 rounded font-mono text-[11px] text-zinc-700">
                  get_saved_jobs
                </span>
                <span className="bg-white border border-zinc-200 px-2 py-0.5 rounded font-mono text-[11px] text-zinc-700">
                  get_top_skills
                </span>
                <span className="bg-white border border-zinc-200 px-2 py-0.5 rounded font-mono text-[11px] text-zinc-700">
                  search_jobs
                </span>
              </div>
              <div className="text-[11px] text-zinc-500">
                {session?.user?.email ? (
                  <span>User: <strong className="text-zinc-700">{session.user.email}</strong></span>
                ) : (
                  <span>Guest mode (sign in to query private saved jobs)</span>
                )}
              </div>
            </div>

            {/* suggested queries */}
            <div className="space-y-1.5">
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">Suggested queries</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "What skill appears most often across jobs?",
                  "Which of my saved roles close this week?",
                  "Find remote software engineering jobs",
                  "Tell me about my saved roles and matches",
                ].map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendChat(suggestion)}
                    disabled={chatLoading}
                    className="text-xs border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-1.5 rounded-md transition-colors text-left disabled:opacity-50 cursor-pointer"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {/* chat message history */}
            <div className="h-[380px] overflow-y-auto space-y-3 p-4 border rounded-lg bg-zinc-50/40 text-xs">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <span className="text-[10px] text-zinc-400 font-medium mb-1 px-1">
                    {m.role === "user" ? "You" : "Nexus Agent"}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-lg p-3 text-xs leading-relaxed ${m.role === "user"
                      ? "bg-zinc-900 text-white"
                      : "bg-white border border-zinc-200 text-zinc-800"
                      }`}
                  >
                    {m.role === "bot" ? formatAgentText(m.text) : m.text}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex flex-col items-start">
                  <span className="text-[10px] text-zinc-400 font-medium mb-1 px-1">Nexus Agent</span>
                  <div className="bg-white border border-zinc-200 text-zinc-500 rounded-lg p-3 text-xs flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping"></span>
                    <span>Querying PostgreSQL database via Gemini tool calling...</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* chat input box */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendChat();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                placeholder="Ask about saved jobs, deadlines, top skills, or remote roles..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatLoading}
                className="text-xs flex-1 border border-zinc-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:border-zinc-500 transition-colors bg-white"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="text-xs bg-black text-white px-5 py-2.5 rounded-md hover:opacity-85 disabled:opacity-40 font-medium transition-opacity cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </section>
      )}
    </main>
  );
}
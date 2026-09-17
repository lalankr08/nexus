# Nexus: Autonomous Career Intelligence Agent

Job listings on the internet are scattered, messy, and badly structured across different websites with no clean API to fetch them. I built Nexus to solve this problem by making an automated pipeline that scrapes job postings from the web, cleans and structures them using an LLM, generates vector embeddings for semantic search, and matches them against a user's resume with AI-generated justifications.

---

## Architecture & How the Data Flows

I split the whole system into separate, independent stages so that if one stage fails or needs updating, the rest of the pipeline keeps working properly:

```text
[ Job Boards: Hacker News & GitHub Issues ]
                 │
                 ▼ (Playwright / headless Chromium)
          [ scraper.py ]
                 │
                 ▼ (Deduplication via PRIMARY KEY `srcUrl`)
    [(DB) Supabase PostgreSQL: rawList]
                 │
                 ▼ (gemini-flash-lite-latest + Structured JSON)
         [ extract.py ]
                 │
                 ▼ (Cached Structured Records)
    [(DB) Supabase PostgreSQL: strList]
                 │
                 ▼ (gemini-embedding-001 / 768-dim)
          [ embed.py ]
                 │
                 ▼ (Stored as pgvector embeddings)
      [ strList.emb Column ]
                 │
    ┌────────────┴───────────────────────────┐
    ▼                                        ▼
 [ FastAPI Backend Services ]          [ Next.js Frontend Dashboard ]
 - /api/match (PDF + Cosine Search)    - Match Resume Tab
 - /api/chat (Agent Tool Calling)      - Saved List Tab (Shortlist)
 - /api/shortlist (Multi-tenant DB)    - Browse Jobs Tab
 - /api/jobs (Live Catalog API)        - Career Agent Chat Tab
```

1. **Scraping**: `scraper.py` uses Playwright to open job boards, handle pagination, and collect the raw post text and source URL.
2. **Structuring**: `extract.py` takes the raw text, sends it in batches to Gemini Flash Lite, and forces the response into a fixed JSON schema so we get consistent fields like title, company, location, skills, and stipend.
3. **Embedding**: `embed.py` combines the job title, company, and required skills into a semantic text string and calls `gemini-embedding-001` to generate a 768-dimensional vector, storing it into the `emb` column in PostgreSQL.
4. **Resume Matching**: When a user uploads a resume PDF, FastAPI extracts the text (using `pypdf` with a `pymupdf` fallback), generates a vector embedding for the resume, and runs a cosine distance query (`emb <=> resVector`) against the database to rank the closest matching jobs. Then Gemini writes a one-line explanation for why each role fits.
5. **The Agent**: `agent.py` connects Gemini Flash Lite directly to PostgreSQL via native function calling (`get_saved_jobs`, `get_top_skills`, and `search_jobs`). It lets users ask questions in plain English without hallucinations or prompt dumping.
6. **Multi-Tenant Saved List**: Users can save jobs to their shortlist with a single click. In the backend, items are joined against the authenticated user's ID in the database so each user has their own private saved roles with scores and justifications.
7. **Frontend**: A clean, minimal Next.js dashboard with dedicated tabs for Resume Matching, Saved Shortlist, Browse Jobs, and an interactive Career Agent Chat interface with 1-click query suggestions and markdown link rendering.

---

## Tech Stack

* **Frontend:** Next.js (App Router), React, Tailwind CSS for a clean white UI, and NextAuth for Google and GitHub authentication.
* **Backend API:** FastAPI with Uvicorn. It is fast, lightweight, and uses Pydantic for validation. For reading resumes, it uses `pypdf` with a `pymupdf` fallback so even tricky PDFs don't fail silently.
* **Database & Vector Search:** Supabase PostgreSQL with the `pgvector` extension. This lets us keep both normal relational tables and vector embeddings in the same database without needing a separate vector DB service.
* **LLM & Embeddings:** Google Gemini (`gemini-flash-lite-latest` for fast JSON extraction and justifications, and `gemini-embedding-001` with `output_dimensionality=768` to fit our pgvector column).
* **Scraper:** Python Playwright with headless Chromium so it can handle dynamic pages and pagination smoothly.

---

## Deduplication Strategy

To keep the database clean and make sure we don't waste API tokens by extracting or embedding the same job twice, I handled deduplication at three levels:

1. **Database Level (Primary Keys):** In the `rawList` table, `srcUrl` is the primary key. Because a URL is unique for each job post, the database rejects any attempt to insert a URL that is already there.
2. **Application Level (Exception Handling):** In `scraper.py`, when we try to insert an existing job, PostgreSQL throws an `IntegrityError`. The script catches this, rolls back the transaction, and skips to the next job without crashing the scraper.
3. **Extraction & Embedding Level:** In `extract.py`, we explicitly query for URLs from `rawList` that do not yet exist in `strList`. When saving, we also use `ON CONFLICT (srcUrl) DO NOTHING`. This guarantees we never pay the Gemini API twice for the same listing.

---

## Database Schema

Here is the SQL schema used in Supabase PostgreSQL:

```sql
-- 1. Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Raw scraped listings
CREATE TABLE IF NOT EXISTS rawList (
    srcUrl TEXT PRIMARY KEY,
    src TEXT,
    rawText TEXT,
    scrapedAt TIMESTAMP
);

-- 3. Clean structured listings with embeddings
CREATE TABLE IF NOT EXISTS strList (
    id SERIAL PRIMARY KEY,
    srcUrl TEXT UNIQUE REFERENCES rawList(srcUrl),
    title TEXT,
    company TEXT,
    loc TEXT,
    isRemote BOOLEAN,
    stipend TEXT,
    skills TEXT[],
    expLvl TEXT,
    deadline TEXT,
    emb vector(768)
);

-- 4. User accounts (for multi-tenant sessions)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL
);

-- 5. Saved shortlist per user
CREATE TABLE IF NOT EXISTS shortlist (
    id SERIAL PRIMARY KEY,
    userId UUID REFERENCES users(id),
    jobId INT REFERENCES strList(id),
    matchScore FLOAT,
    just TEXT,
    UNIQUE(userId, jobId)
);
```

---

## Environment Variables

You need two environment files to run the project:

### 1. Backend (`backend/.env`)
```ini
DATABASE_URL=postgresql://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
GEMINI_API_KEY=your_gemini_api_key
```
> **Note:** Use the Supabase IPv4 Session Pooler connection string (port 6543). If your database password has special characters like `#`, make sure to URL-encode them (e.g., `#` becomes `%23`).

### 2. Frontend (`frontend/.env.local`)
```ini
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_random_secret_here
GITHUB_ID=your_github_oauth_client_id
GITHUB_SECRET=your_github_oauth_client_secret
GOOGLE_ID=your_google_oauth_client_id
GOOGLE_SECRET=your_google_oauth_client_secret
```

---

## How to Setup & Run

### Prerequisites
* Python 3.10+
* Node.js 18+
* Supabase PostgreSQL database with `pgvector`

### 1. Backend Setup
Open a terminal in the root directory:
```bash
cd backend
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install psycopg2-binary playwright google-genai pydantic python-dotenv fastapi uvicorn pypdf pymupdf python-multipart

# Install Playwright browser
playwright install chromium
```

Run the pipeline scripts in order:
```bash
python scraper.py     # Scrapes raw job listings from HN and GitHub
python extract.py     # Extracts clean structured fields via Gemini
python embed.py       # Computes 768-dim vector embeddings

# Start the backend server on port 8000
uvicorn main:app --reload --port 8000
```

### 2. Frontend Setup
Open a second terminal window:
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. Next.js automatically proxies `/api/py/*` requests to the FastAPI backend on port 8000.

---

## Project Status: What is Done & What is Next

### What is Completed:
* **Step 1 (The Scraper):** Scrapes live listings from two different public sources (Hacker News and GitHub), handles pagination, stores source URLs and timestamps, and avoids duplicates.
* **Step 2 (LLM Structured Extraction):** Batches raw listings, validates against a strict schema using Gemini Flash Lite, handles rate limits gracefully with backoff, and caches so no listing is parsed twice.
* **Step 3 (Resume Matching & Semantic Search):** Users can upload a resume PDF. The backend extracts text with dual-engine fallback (`pypdf` + `pymupdf`), computes vector embeddings, finds the top matches using pgvector cosine distance, and generates a one-line explanation for each match.
* **Step 4 (The Agent):** Natural language career agent powered by Gemini tool calling with 3 distinct database tools (`get_saved_jobs`, `get_top_skills`, `search_jobs`). Queries PostgreSQL live without dumping prompt rows, and features an interactive chat UI with suggested queries and clickable markdown links.
* **Step 6 (Authentication, Persistence & Shortlist):** NextAuth session authentication with Google OAuth, multi-tenant shortlist database persistence per user (scoped to `users.id`), and clean text save toggles with a dedicated "Saved List" view.

### What is Unfinished & Planned for Next:
* **Step 5 (Video Briefing):** Generating an asynchronous 60-90 second avatar video or TTS audio briefing summarizing the top three matches of the week (LLM script generation -> async API job lifecycle polling `queued -> processing -> done/failed` -> in-app playback).
  The way i would solve it would be:
  1. Take top 3 matches from shortlist and prompt gemini flash lite to write an engaging 60-90 seconds spoken script with details about the roles, required skills, and why they fit there.
  2. Send the script to the video/audio provider (HeyGen / Edge-TTS / ElevenLabs as audio fallback if credits run out). It immediately returns a job ID with queued status so we never block request threads.
  3. Handle the async job lifecycle in the background (queued -> processing -> done / failed). A worker or polling endpoint checks the status, and once finished, stores the final media URL in the database.
  4. Show a clean progress state on the frontend while rendering, then embed an in-app player so the user can play their briefing right from the dashboard and access past briefings from their shortlist.



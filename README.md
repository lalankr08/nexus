# nexus
# Nexus: Autonomous Career Intelligence Agent

Nexus is an end-to-end system built to automate the job search pipeline. It scrapes live job listings, uses LLMs to extract clean and structured data, indexes that data via vector embeddings, and matches candidate resumes using semantic vector search. 

## Architecture & Data Flow

The system is split into independent steps for data ingestion, processing, and consumption. Here is how the data flows:

```text
[ Job Boards: HN & GitHub Issues ]
                │
                ▼ (Playwright / headless Chromium)
         [ scrape.py ]
                │
                ▼ (Deduplication via PRIMARY KEY `srcUrl`)
   [(DB) Supabase PostgreSQL: rawList]
                │
                ▼ (Gemini 2.5 Flash + Structured JSON Schema)
        [ extract.py ]
                │
                ▼ (Strict Typed Records)
   [(DB) Supabase PostgreSQL: strList]
                │
                ▼ (text-embedding-004 / 768-dim)
         [ embed.py ]
                │
                ▼ (Vector Storage via pgvector)
     [ strList.emb Column ]
                │
   ┌────────────┴────────────┐
   ▼                         ▼
[ FastAPI: /api/match ]   [ Next.js Frontend ]
(PDF Parsing + Cosine     (Clean Dashboard + OAuth
 Similarity + Just)       Multi-tenant User Space)
```
## Tech Stack
* **Frontend:** Next.js (App Router), Tailwind CSS, NextAuth.js for GitHub and Google OAuth.
* **Backend API:** FastAPI running via Uvicorn, using Pydantic for validation and PyPDF for resume ingestion.
* **Storage & Vectors:** Supabase PostgreSQL with the pgvector extension enabled.
* **LLM & Embeddings:** Google Gemini (gemini-2.5-flash for JSON extraction, text-embedding-004 for vector generation).
* **Scraper:** Python Playwright to handle automated pagination and dynamic page rendering.

## Deduplication Strategy
To keep the database clean and avoid wasting API credits, deduplication happens at both the database and application levels:

* **Database Level (Primary Keys):** The raw scraped data table uses the source URL (`srcUrl`) as its primary key. This treats every URL as a unique, immutable identifier.
* **Application Level (Error Handling):** During the scraping phase, if Playwright tries to insert a job that already exists, PostgreSQL throws an `IntegrityError`. The script catches this, rolls back the transaction, and moves on to the next link without crashing.
* **Pipeline Level (Query Filtering):** The AI extraction script explicitly queries for URLs that do not yet exist in the structured table. This ensures the Gemini API only processes net-new listings.

## Database Schema
You will need to run this SQL in your Supabase SQL Editor to set up the tables:

```sql
-- Enable vector search extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Raw scraped data
CREATE TABLE IF NOT EXISTS rawList (
    srcUrl TEXT PRIMARY KEY,
    src TEXT,
    rawText TEXT,
    scrapedAt TIMESTAMP
);

-- Structured data + embeddings
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

-- Multi-tenant isolation & saved shortlists
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS shortlist (
    id SERIAL PRIMARY KEY,
    userId UUID REFERENCES users(id),
    jobId INT REFERENCES strList(id),
    matchScore FLOAT,
    just TEXT,
    UNIQUE(userId, jobId)
);
```
## Environment Variables
You need two separate environment files to run the full stack.

### Backend (.env)
Create a `.env` file in your `backend` directory:

```ini
DATABASE_URL=postgresql://postgres.[REF]:[PASSWORD]@aws-0-[REGION][.pooler.supabase.com:6543/postgres](https://.pooler.supabase.com:6543/postgres)
GEMINI_API_KEY=your_gemini_api_key
```
Note: Make sure to use the Supabase IPv4 Session Pooler connection string (port 6543). If your database password contains special characters like #, you must URL-encode them (e.g., replace # with %23).

### Frontend (.env.local)
Create a `.env.local` file in your frontend directory:
```ini
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_generated_random_secret
GITHUB_ID=your_github_oauth_client_id
GITHUB_SECRET=your_github_oauth_client_secret
GOOGLE_ID=your_google_oauth_client_id
GOOGLE_SECRET=your_google_oauth_client_secret
```



### Honest List of What is Unfinished

Frontend PDF Upload Integration: The FastAPI backend perfectly handles PDF parsing and semantic matching at the /api/match endpoint. However, the Next.js frontend upload form is currently just a visual placeholder and still needs the fetch logic written to send the file and render the results.

Autonomous Agent Chat UI: The underlying logic for a tool-calling assistant (which can trigger SQL queries via Gemini) is mapped out, but it has not been wired into the frontend chat interface yet.

Audio/Video Briefings: The planned feature to generate automated daily briefings (turning text into speech and rendering video) is completely unbuilt at this stage.

Automated Scheduling: Right now, the scraper and extraction scripts have to be run manually from the terminal. I still need to set up a headless cron job (like GitHub Actions) to automate this daily.

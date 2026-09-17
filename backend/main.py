import io
import os
from typing import Optional
from pydantic import BaseModel
import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import pypdf
import pymupdf
from google import genai
from google.genai import types
from google.genai.models import Models

from scraper import setupDb, scrapeHn, scrapeGh
from extract import runExtract
from agent import askAgent

Models._logged_afc_warning = True
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()
dbUrl = os.getenv("DATABASE_URL")
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI(title="Nexus API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def runPipeline():
    conn = setupDb()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent="NexusAgent/0.1")
        page = ctx.new_page()
        scrapeHn(page, conn, maxPg=1)
        scrapeGh(page, conn, maxPg=1)
        browser.close()
    conn.close()
    runExtract()

@app.post("/api/sync")
def triggerSync(bgTasks: BackgroundTasks):
    bgTasks.add_task(runPipeline)
    return {"status": "ok", "msg": "syncing in background"}

@app.get("/api/jobs")
def fetchJobs():
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, srcUrl, title, company, loc, isRemote, stipend, skills, expLvl, deadline 
        FROM strList
    """)
    rows = cursor.fetchall()
    conn.close()
    
    data = []
    for r in rows:
        data.append({
            "id": r[0],
            "srcUrl": r[1],
            "title": r[2],
            "company": r[3],
            "loc": r[4],
            "isRemote": r[5],
            "stipend": r[6],
            "skills": r[7],
            "expLvl": r[8],
            "deadline": r[9]
        })
    return {"jobs": data}

@app.post("/api/match")
async def matchResume(file: UploadFile = File(...)):
    content = await file.read()
    
    # try pypdf first
    resText = ""
    try:
        pdf = pypdf.PdfReader(io.BytesIO(content))
        resText = "".join(pg.extract_text() or "" for pg in pdf.pages)
    except Exception:
        pass

    # fallback if pypdf choked
    if not resText.strip():
        try:
            doc = pymupdf.open(stream=content, filetype="pdf")
            resText = "".join(page.get_text() for page in doc)
            doc.close()
        except Exception:
            pass

    # if empty the pdf is probably a scanned ....
    if not resText or len(resText.strip()) < 10:
        return {
            "matches": [],
            "error": "could not read text from this pdf, make sure it has selectable text"
        }

    try:
        embRes = client.models.embed_content(
            model="gemini-embedding-001", 
            contents=resText[:5000],
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        resVector = embRes.embeddings[0].values
    except Exception as e:
        return {
            "matches": [],
            "error": f"embedding failed: {str(e)}"
        }

    # math magic with pgvector
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, title, company, loc, srcUrl, 1 - (emb <=> %s::vector) AS score, skills 
        FROM strList 
        WHERE emb IS NOT NULL
        ORDER BY emb <=> %s::vector 
        LIMIT 5
    """, (resVector, resVector))
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "matches": [],
            "error": "no jobs found with embeddings in db"
        }

    matches = []
    for r in rows:
        jid, title, comp, loc, url, score, skills = r
        prompt = f"Resume: {resText[:1200]}\nJob: {title} at {comp}. Skills: {skills}\nWrite exactly one short sentence justifying why this is a match."
        try:
            genRes = client.models.generate_content(
                model="gemini-flash-lite-latest",
                contents=prompt
            )
            just = genRes.text.strip() if genRes.text else "matches technical requirements"
        except Exception:
            just = "matches technical requirements"

        matches.append({
            "id": jid,
            "title": title,
            "company": comp,
            "loc": loc or "Not specified",
            "url": url,
            "score": round(score, 2),
            "matchScore": round(score, 2),
            "just": just
        })

    return {"matches": matches, "error": None}

class ShortlistReq(BaseModel):
    email: str
    jobId: int
    matchScore: Optional[float] = None
    just: Optional[str] = ""

@app.get("/api/shortlist")
def fetchShortlist(email: str = ""):
    if not email:
        return {"shortlist": []}
    
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, s.jobId, s.matchScore, s.just, j.title, j.company, j.loc, j.srcUrl
        FROM shortlist s
        JOIN strList j ON s.jobId = j.id
        JOIN users u ON s.userId = u.id
        WHERE u.email = %s
        ORDER BY s.id DESC
    """, (email,))
    rows = cursor.fetchall()
    conn.close()

    items = []
    for r in rows:
        items.append({
            "id": r[0],
            "jobId": r[1],
            "matchScore": r[2],
            "just": r[3],
            "title": r[4],
            "company": r[5],
            "loc": r[6],
            "url": r[7]
        })
    return {"shortlist": items}

@app.post("/api/shortlist")
def toggleShortlist(req: ShortlistReq):
    # save or unsave job for this user
    if not req.email:
        return {"status": "error", "msg": "email required"}
    
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO users (email) 
        VALUES (%s) 
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email 
        RETURNING id;
    """, (req.email,))
    uid = cursor.fetchone()[0]

    cursor.execute("SELECT id FROM shortlist WHERE userId = %s AND jobId = %s", (uid, req.jobId))
    exists = cursor.fetchone()

    if exists:
        cursor.execute("DELETE FROM shortlist WHERE userId = %s AND jobId = %s", (uid, req.jobId))
        action = "removed"
    else:
        cursor.execute("""
            INSERT INTO shortlist (userId, jobId, matchScore, just)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (userId, jobId) DO NOTHING
        """, (uid, req.jobId, req.matchScore or 0.0, req.just or ""))
        action = "saved"

    conn.commit()
    conn.close()
    return {"status": action, "jobId": req.jobId}

class ChatReq(BaseModel):
    message: str
    email: Optional[str] = ""

@app.post("/api/chat")
def chatAgent(req: ChatReq):
    # let agent query tools and answer
    reply = askAgent(req.message, email=req.email or "")
    return {"reply": reply}
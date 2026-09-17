import io
from fastapi import FastAPI, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
import os
from dotenv import load_dotenv
import pypdf
import pymupdf
from google import genai
from google.genai import types
from google.genai.models import Models

from scraper import setupDb, scrapeHn, scrapeGh
from extract import runExtract  

Models._logged_afc_warning = True
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
    """Background task to sequence scraping then extraction."""
    
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
    """Frontend calls this to start the data pipeline without freezing the UI."""
    bgTasks.add_task(runPipeline)
    return {"status": "ok", "msg": "Pipeline started in background"}

@app.get("/api/jobs")
def fetchJobs():
    """Frontend calls this to display the structured data."""
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
    
    # 1. Try pypdf
    resText = ""
    try:
        pdf = pypdf.PdfReader(io.BytesIO(content))
        resText = "".join(pg.extract_text() or "" for pg in pdf.pages)
    except Exception:
        pass

    # 2. Fallback to pymupdf
    if not resText.strip():
        try:
            doc = pymupdf.open(stream=content, filetype="pdf")
            resText = "".join(page.get_text() for page in doc)
            doc.close()
        except Exception:
            pass

    if not resText or len(resText.strip()) < 10:
        return {
            "matches": [],
            "error": "Could not extract text from this PDF. Please upload a PDF with selectable text."
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
            "error": f"Failed to generate embedding: {str(e)}"
        }

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
            "error": "No indexed listings found in database."
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
            just = genRes.text.strip() if genRes.text else "Matches technical background and requirements."
        except Exception:
            just = "Matches technical background and requirements."

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

    return {
        "matches": matches,
        "error": None
    }
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
import os
from dotenv import load_dotenv

from fastapi import UploadFile, File
import pypdf
import google.generativeai as genai

# Import functions from your existing scripts
from scrape import setupDb, scrapeHn, scrapeGh
from extract import runExtract  

load_dotenv()
dbUrl = os.getenv("DATABASE_URL")

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
    # 1. Scrape HTML to rawList
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
    
    # 2. Extract JSON to strList via Gemini
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
    # 1. Parse PDF
    pdf = pypdf.PdfReader(file.file)
    resText = "".join(pg.extract_text() for pg in pdf.pages)
    
    # 2. Embed Resume
    embRes = genai.embed_content(
        model="models/text-embedding-004", 
        content=resText
    )
    resVector = embRes['embedding']
    
    # 3. Vector Search (Cosine Similarity)
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, title, company, srcUrl, 1 - (emb <=> %s::vector) AS score, skills 
        FROM strList 
        WHERE emb IS NOT NULL
        ORDER BY emb <=> %s::vector 
        LIMIT 3
    """, (resVector, resVector))
    
    matches = cursor.fetchall()
    
    # 4. Generate One-Line Justification
    model = genai.GenerativeModel("gemini-1.5-flash")
    data = []
    
    for m in matches:
        jid, title, comp, url, score, skills = m
        prompt = f"Resume: {resText[:1500]}\nJob: {title} at {comp}. Skills: {skills}\nWrite exactly one short sentence justifying why this is a match."
        
        just = model.generate_content(prompt).text.strip()
        
        data.append({
            "id": jid, 
            "title": title, 
            "company": comp, 
            "url": url, 
            "score": round(score, 2), 
            "just": just
        })
        
    conn.close()
    return {"matches": data}
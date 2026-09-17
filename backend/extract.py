import os
import json
import psycopg2
import time
import re
from google import genai
from google.genai import types
from google.genai.models import Models
from pydantic import BaseModel
from dotenv import load_dotenv

Models._logged_afc_warning = True
load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
dbUrl = os.getenv("DATABASE_URL")
batchSize = 5
reqDelay = 4.0

class JobItem(BaseModel):
    srcUrl: str
    title: str
    company: str
    loc: str
    isRemote: bool
    stipend: str
    skills: list[str]
    expLvl: str
    deadline: str

class BatchSchema(BaseModel):
    jobs: list[JobItem]

def runExtract():
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT srcUrl, rawText FROM rawList 
        WHERE srcUrl NOT IN (SELECT srcUrl FROM strList)
    """)
    rawJobs = cursor.fetchall()

    if not rawJobs:
        print("[done] no new jobs, going back to sleep")
        conn.close()
        return

    print(f"[info] found {len(rawJobs)} jobs to parse, batching by {batchSize}...")

    for i in range(0, len(rawJobs), batchSize):
        chunk = rawJobs[i:i + batchSize]
        prompt = "Extract details for each job below. Unknown fields = 'Not specified' or false.\n\n"
        for idx, (url, text) in enumerate(chunk):
            prompt += f"--- JOB {idx + 1} | URL: {url} ---\n{text}\n\n"

        success = False
        attempts = 0
        
        while not success and attempts < 5:
            try:
                # gemini please be gentle with my free quota
                res = client.models.generate_content(
                    model="gemini-flash-lite-latest", 
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=BatchSchema,
                        temperature=0
                    )
                )
                
                data = json.loads(res.text)
                parsedJobs = data.get("jobs", [])

                for j in parsedJobs:
                    cursor.execute("""
                        INSERT INTO strList 
                        (srcUrl, title, company, loc, isRemote, stipend, skills, expLvl, deadline)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (srcUrl) DO NOTHING
                    """, (
                        j.get("srcUrl"), 
                        j.get("title"), 
                        j.get("company"), 
                        j.get("loc"),
                        j.get("isRemote"), 
                        j.get("stipend"), 
                        j.get("skills"),
                        j.get("expLvl"), 
                        j.get("deadline")
                    ))
                conn.commit()

                for j in parsedJobs:
                    print(f"[saved] {j.get('srcUrl')}")

                success = True
                # to stop rate limit
                time.sleep(reqDelay)
                
            except Exception as e:
                attempts += 1
                conn.rollback()
                errStr = str(e)
                
                # if google says, wait and retry
                if "429" in errStr or "503" in errStr or "RESOURCE_EXHAUSTED" in errStr:
                    match = re.search(r'retry in ([0-9.]+)s', errStr)
                    waitSec = float(match.group(1)) + 2.0 if match else 25.0 * attempts
                    print(f"[rate limit] google told us to wait {waitSec:.1f}s (try {attempts}/5)")
                    time.sleep(waitSec)
                else:
                    print(f"[batch error] {e}")
                    break

    conn.close()

if __name__ == "__main__":
    runExtract()
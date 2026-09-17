import os
import json
import psycopg2
import time
from google import genai
from google.genai import types
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
dbUrl = os.getenv("DATABASE_URL")

class JobSchema(BaseModel):
    title: str
    company: str
    loc: str
    isRemote: bool
    stipend: str
    skills: list[str]
    expLvl: str
    deadline: str

def runExtract():
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT srcUrl, rawText FROM rawList 
        WHERE srcUrl NOT IN (SELECT srcUrl FROM strList)
    """)
    unprocessed = cursor.fetchall()

    for url, rawText in unprocessed:
        success = False
        attempts = 0
        
        while not success and attempts < 3:
            try:
                response = client.models.generate_content(
                    model="gemini-3.6-flash", 
                    contents=f"Extract job details. Unknown fields = 'Not specified' or false.\n\nText: {rawText}",
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=JobSchema,
                        temperature=0
                    )
                )
                
                data = json.loads(response.text)
                
                cursor.execute("""
                    INSERT INTO strList 
                    (srcUrl, title, company, loc, isRemote, stipend, skills, expLvl, deadline)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    url, 
                    data.get("title"), 
                    data.get("company"), 
                    data.get("loc"),
                    data.get("isRemote"), 
                    data.get("stipend"), 
                    data.get("skills"),
                    data.get("expLvl"), 
                    data.get("deadline")
                ))
                conn.commit()
                print(f"[Extracted] {url}")
                success = True
                
                # Stay comfortably under the 5 RPM free tier limit
                time.sleep(15)
                
            except Exception as e:
                attempts += 1
                error_msg = str(e)
                
                if "429" in error_msg or "503" in error_msg:
                    print(f"[Rate Limited / Server Busy] Waiting 60s before retry... (Attempt {attempts}/3)")
                    time.sleep(60)
                else:
                    conn.rollback()
                    print(f"[Failed] {url} -> {e}")
                    break # Break the while loop if it's a parsing/code error, not a rate limit

    conn.close()

if __name__ == "__main__":
    runExtract()
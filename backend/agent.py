import os
import psycopg2
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()
dbUrl = os.getenv("DATABASE_URL")
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

def get_saved_jobs(email: str = "") -> list:
    """Get the user's saved shortlist jobs including title, company, deadline, and match score."""
    if not email:
        return [{"msg": "no email provided, user might not be logged in"}]
    
    conn = psycopg2.connect(dbUrl)
    cur = conn.cursor()
    cur.execute("""
        SELECT j.id, j.title, j.company, j.loc, j.deadline, s.matchScore, s.just, j.srcUrl
        FROM shortlist s
        JOIN strList j ON s.jobId = j.id
        JOIN users u ON s.userId = u.id
        WHERE u.email = %s
        ORDER BY s.id DESC
    """, (email,))
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return [{"msg": f"no saved jobs found for {email}"}]

    return [
        {
            "id": r[0],
            "title": r[1],
            "company": r[2],
            "loc": r[3],
            "deadline": r[4] or "Not specified",
            "matchScore": r[5],
            "just": r[6],
            "url": r[7]
        }
        for r in rows
    ]

def get_top_skills(limit: int = 5) -> list:
    """Get the most frequently required skills across job listings in the database."""
    conn = psycopg2.connect(dbUrl)
    cur = conn.cursor()
    cur.execute("""
        SELECT unnest(skills) AS skill, COUNT(*) AS count
        FROM strList
        WHERE skills IS NOT NULL
        GROUP BY skill
        ORDER BY count DESC
        LIMIT %s;
    """, (limit,))
    rows = cur.fetchall()
    conn.close()
    return [{"skill": r[0], "count": r[1]} for r in rows]

def search_jobs(keyword: str = "", is_remote: bool = False, skill: str = "") -> list:
    """Search for jobs by keyword in title/company, remote preference, or specific skill."""
    conn = psycopg2.connect(dbUrl)
    cur = conn.cursor()
    q = "SELECT id, title, company, loc, isRemote, skills, srcUrl, deadline FROM strList WHERE 1=1"
    params = []

    if is_remote:
        q += " AND isRemote = true"
    if keyword:
        q += " AND (title ILIKE %s OR company ILIKE %s)"
        params.extend([f"%{keyword}%", f"%{keyword}%"])
    if skill:
        q += " AND %s = ANY(skills)"
        params.append(skill)

    q += " LIMIT 5"
    cur.execute(q, tuple(params))
    rows = cur.fetchall()
    conn.close()

    return [
        {
            "id": r[0],
            "title": r[1],
            "company": r[2],
            "loc": r[3],
            "isRemote": r[4],
            "skills": r[5],
            "url": r[6],
            "deadline": r[7]
        }
        for r in rows
    ]

def askAgent(message: str, email: str = "") -> str:
    # prompt context with user email if available
    sysPrompt = "You are Nexus, an autonomous career intelligence agent. Use the provided tools to query the database and answer the user's questions clearly and concisely. Do not guess data; always use tools to fetch accurate details."
    if email:
        sysPrompt += f" The current user's email is '{email}'. Pass this email to tools when querying saved jobs."

    chat = client.chats.create(
        model="gemini-flash-lite-latest",
        config=types.GenerateContentConfig(
            system_instruction=sysPrompt,
            temperature=0,
            tools=[get_saved_jobs, get_top_skills, search_jobs]
        )
    )

    res = chat.send_message(message)
    return res.text.strip() if res.text else "no response from agent"

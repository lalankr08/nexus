import os
import psycopg2
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
dbUrl = os.getenv("DATABASE_URL")

def embedJobs():
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, title, company, skills 
        FROM strList 
        WHERE emb IS NULL
    """)
    jobs = cursor.fetchall()

    if not jobs:
        print("[done] all jobs already embedded, sweet")
        conn.close()
        return

    print(f"[info] generating vectors for {len(jobs)} jobs...")

    for jid, title, comp, skills in jobs:
        skillStr = " ".join(skills) if skills else ""
        textToEmbed = f"Role: {title} at {comp}. Required skills: {skillStr}"
        
        try:
            # 768 dims so pgvector doesn't get sad
            res = client.models.embed_content(
                model="gemini-embedding-001",
                contents=textToEmbed,
                config=types.EmbedContentConfig(output_dimensionality=768)
            )
            emb = res.embeddings[0].values
            
            cursor.execute("UPDATE strList SET emb = %s::vector WHERE id = %s", (emb, jid))
            conn.commit()
            print(f"[embedded] job {jid}")
            
        except Exception as e:
            conn.rollback()
            print(f"[oops] job {jid} broke -> {e}")

    conn.close()

if __name__ == "__main__":
    embedJobs()
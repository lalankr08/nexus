import os
import psycopg2
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
dbUrl = os.getenv("DATABASE_URL")

def embedJobs():
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    
    # Fetch jobs that don't have an embedding yet
    cursor.execute("""
        SELECT id, title, company, skills 
        FROM strList 
        WHERE emb IS NULL
    """)
    jobs = cursor.fetchall()

    for jid, title, comp, skills in jobs:
        # Combine fields into a single semantic string
        skillStr = " ".join(skills) if skills else ""
        textToEmbed = f"Role: {title} at {comp}. Required skills: {skillStr}"
        
        try:
            # text-embedding-004 outputs a 768-dimensional vector
            res = genai.embed_content(
                model="models/text-embedding-004",
                content=textToEmbed
            )
            emb = res['embedding']
            
            # Update the database
            cursor.execute("UPDATE strList SET emb = %s::vector WHERE id = %s", (emb, jid))
            conn.commit()
            print(f"[Embedded] Job ID: {jid}")
            
        except Exception as e:
            conn.rollback()
            print(f"[Error] Job ID: {jid} -> {e}")

    conn.close()

if __name__ == "__main__":
    embedJobs()
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
            # gemini-embedding-001 with 768 dimensions for pgvector column
            res = client.models.embed_content(
                model="gemini-embedding-001",
                contents=textToEmbed,
                config=types.EmbedContentConfig(output_dimensionality=768)
            )
            emb = res.embeddings[0].values
            
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
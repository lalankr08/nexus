import os
import time
from datetime import datetime, timezone
import psycopg2
from psycopg2 import IntegrityError
from playwright.sync_api import sync_playwright
from dotenv import load_dotenv

load_dotenv()

uAgent = "NexusAgent/0.1"
reqDelay = 2.0
dbUrl = os.getenv("DATABASE_URL")

def nowIso():
    return datetime.now(timezone.utc).isoformat()

def setupDb():
    conn = psycopg2.connect(dbUrl)
    cursor = conn.cursor()
    cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS rawList (
            srcUrl TEXT PRIMARY KEY,
            src TEXT,
            rawText TEXT,
            scrapedAt TIMESTAMP
        )
    """)
    conn.commit()
    return conn

def saveList(conn, src, srcUrl, rawText):
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO rawList (srcUrl, src, rawText, scrapedAt)
            VALUES (%s, %s, %s, %s)
        """, (srcUrl, src, rawText, nowIso()))
        conn.commit()
        print(f"[Saved] {srcUrl}")
    except IntegrityError:
        conn.rollback() 
        print(f"[Dup] {srcUrl}")

def scrapeHn(page, conn, maxPg=2):
    page.goto("https://news.ycombinator.com/jobs")
    for pg in range(maxPg):
        time.sleep(reqDelay)
        rows = page.locator("tr.athing").all()
        for r in rows:
            title = r.locator("td.title a, td.title span.titleline a").first
            if title.count() > 0:
                rawText = title.inner_text()
                url = title.get_attribute("href")
                if url.startswith("item?id="):
                    url = f"https://news.ycombinator.com/{url}"
                saveList(conn, "hn", url, rawText)
        
        more = page.locator("a.morelink")
        if more.count() > 0:
            more.first.click()
        else:
            break

def scrapeGh(page, conn, maxPg=2):
    page.goto("https://github.com/frontendbr/vagas/issues")
    for pg in range(maxPg):
        time.sleep(reqDelay)
        issues = page.locator("div[aria-label='Issues'] div.js-navigation-container > div.js-issue-row").all()
        for i in issues:
            title = i.locator("a.Link--primary")
            if title.count() > 0:
                rawText = title.inner_text()
                url = "https://github.com" + title.get_attribute("href")
                saveList(conn, "gh", url, rawText)
                
        nxt = page.locator("a.next_page")
        if nxt.count() > 0:
            nxt.first.click()
        else:
            break

def main():
    conn = setupDb()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=uAgent)
        page = ctx.new_page()
        
        scrapeHn(page, conn, maxPg=2)
        scrapeGh(page, conn, maxPg=2)
        
        browser.close()
    
    conn.close()

if __name__ == "__main__":
    main()
# legal_engine.py
"""
LegalSathi — Phase 3: ChatGPT+ Legal Engine helpers.
Drop this file into your backend and import functions in app.py:
from legal_engine import (
    detect_legal_intent, detect_jurisdiction, detect_writing_style,
    generate_contract, generate_tax_reply, generate_docx_stream,
    clause_review, precedent_search, make_jurisdiction_note
)
"""

import io
import uuid
import time
import re
from typing import Optional, Dict, Any, List

# NOTE: this file uses your existing `ask_ai` wrapper (Groq) and `db` from app.py environment.
# If you import this module inside app.py after those exist, it will work.
try:
    from app import db, client, ask_ai
except Exception:
    # If imported standalone for tests, expect caller to provide ask_ai function.
    db = None
    client = None
    ask_ai = None

# -----------------------
# 1) Simple detectors (improve over time)
# -----------------------
def detect_legal_intent(text: str) -> str:
    """
    Intent categories used by stream_chat:
    - contract
    - tax_reply
    - notice_reply
    - clause_review
    - document_summary
    - lawyer_mode
    - general
    """
    t = (text or "").lower()

    # tax keywords
    if any(k in t for k in ["gst", "tax", "income tax", "vat", "hmrc", "irs", "scn", "notice", "section 143", "143(1)", "143(2)", "notice under"]):
        return "tax_reply"

    # contract drafting
    if any(k in t for k in ["draft", "contract", "agreement", "rent agreement", "nda", "service agreement", "moa", "mou"]):
        return "contract"

    # clause review / redline
    if any(k in t for k in ["clause", "redline", "review clause", "strengthen clause", "rewrite clause", "risk", "loophole"]):
        return "clause_review"

    # document summary/explain
    if any(k in t for k in ["summarize", "summarise", "explain", "what does", "summary", "highlight", "find", "extract"]):
        return "document_summary"

    # lawyer mode
    if any(k in t for k in ["advise", "strategy", "case law", "precedent", "legal research", "citation", "argument"]):
        return "lawyer_mode"

    # notice reply
    if any(k in t for k in ["legal notice", "notice reply", "demand notice", "s138", "cheque bounce", "notice under"]):
        return "notice_reply"

    return "general"


def detect_jurisdiction(text: str) -> str:
    """
    Very lightweight jurisdiction detector based on keywords.
    Returns canonical short code or 'global'.
    Improve this later by integrating IP / user preference.
    """
    t = (text or "").lower()
    # simple rules
    if "india" in t or "gst" in t or "income tax" in t or "section 138" in t or "rera" in t:
        return "India"
    if "uk" in t or "hmrc" in t or "uk" in t:
        return "UK"
    if "usa" in t or "california" in t or "irs" in t or "us " in t:
        return "USA"
    if "uae" in t or "vat" in t and "uae" in t:
        return "UAE"
    return "Global"


def detect_writing_style(text: str) -> str:
    """
    Basic style detection: 'formal', 'concise', 'friendly', 'legalese'
    """
    t = (text or "").lower()
    if any(k in t for k in ["draft in formal", "formal", "professional"]):
        return "formal"
    if any(k in t for k in ["brief", "concise", "short"]):
        return "concise"
    if any(k in t for k in ["friendly", "simple"]):
        return "friendly"
    return "legalese"

# -----------------------
# 2) Prompt templates
# -----------------------
CONTRACT_PROMPT = """
You are LegalSathi, an expert contract drafter. Produce a complete contract in {jurisdiction} law.
Requirements:
- Parties: include placeholders for party names, addresses and contact.
- Definitions section.
- Term/duration, consideration, payment schedule.
- Service levels / deliverables (if applicable).
- Warranties, indemnities, limitation of liability.
- Termination, force majeure, dispute resolution, governing law and jurisdiction.
- Signatures with placeholders and dates.
- Use {style} tone.
- Don't hallucinate statute text. If law references required, mark as [CITE_NEEDED].
- Output: return a structured markdown with numbered clauses and a short summary at top.
{extra_instructions}
"""

TAX_REPLY_PROMPT = """
You are LegalSathi, an expert tax reply drafter for {jurisdiction}.
Task: Draft a professional reply to a tax/GST/VAT notice based on provided facts.
Include:
- Short opening (acknowledgement)
- Factual position: cites the relevant invoice / pages if provided
- Legal grounds and references (if known) or mark [CITE_NEEDED]
- Requested documents list
- Clear next steps and timeline
- Tone: professional, non-adversarial (unless asked otherwise)
{extra_instructions}
"""

CLAUSE_REVIEW_PROMPT = """
You are LegalSathi, clause review assistant.
Given the clause below, rewrite it to reduce risk, be clear, and add missing protections.
Return:
1) Improved clause (clean)
2) Short explanation of changes and risks removed.
Clause:
{clause}
"""

# -----------------------
# 3) Core generators
# -----------------------
def generate_contract(jurisdiction: str, user_message: str, style: str = "legalese", extra_instructions: Optional[str] = "") -> str:
    """
    Returns a pre-generated contract template string to feed into the main AI prompt.
    This is intentionally conservative: we generate a structured draft outline that the stream_chat will refine.
    """
    prompt = CONTRACT_PROMPT.format(jurisdiction=jurisdiction, style=style, extra_instructions=extra_instructions)
    # seed with user message to place facts
    full = prompt + "\n\nUser facts:\n" + user_message
    # best-effort: use ask_ai for a quick template (non-stream)
    if ask_ai:
        try:
            out = ask_ai(f"You are LegalSathi. Create a structured contract outline.\n\n{full}")
            return out
        except Exception as e:
            print("generate_contract ask_ai fallback:", e)
            return "## Contract Outline\n\n" + user_message[:1000]
    else:
        return "## Contract Outline\n\n" + user_message[:1000]


def generate_tax_reply(jurisdiction: str, user_message: str, style: str = "legalese", extra_instructions: Optional[str] = "") -> str:
    prompt = TAX_REPLY_PROMPT.format(jurisdiction=jurisdiction, extra_instructions=extra_instructions)
    full = prompt + "\n\nFacts:\n" + user_message
    if ask_ai:
        try:
            out = ask_ai(full)
            return out
        except Exception as e:
            print("generate_tax_reply ask_ai fallback:", e)
            return "Tax reply draft based on facts:\n\n" + user_message[:1000]
    else:
        return "Tax reply draft based on facts:\n\n" + user_message[:1000]


def clause_review(clause_text: str) -> Dict[str, str]:
    if not ask_ai:
        return {"improved": clause_text, "explanation": "AI client not configured."}
    prompt = CLAUSE_REVIEW_PROMPT.format(clause=clause_text)
    out = ask_ai(prompt)
    # simple split: if AI returns both parts in plain text, return whole output as improved for now
    return {"improved": out, "explanation": "See improved clause above."}


# -----------------------
# 4) DOCX generation helper
# -----------------------
def generate_docx_stream(text: str):
    """
    Return (filename, BytesIO) ready to serve via /download_docx/<filename>
    Produces a simple docx using python-docx in memory.
    """
    try:
        from docx import Document
    except Exception as e:
        print("python-docx missing:", e)
        # fallback: return a text file buffer
        buf = io.BytesIO()
        buf.write(text.encode("utf-8"))
        buf.seek(0)
        name = f"{uuid.uuid4().hex[:8]}.docx"
        return name, buf

    doc = Document()
    # split by double newlines into paragraphs
    parts = re.split(r"\n\s*\n", text)
    for p in parts:
        doc.add_paragraph(p.strip())

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    name = f"{uuid.uuid4().hex[:8]}.docx"
    return name, buf


# -----------------------
# 5) Simple precedent search (over file_records/messages)
# -----------------------
def precedent_search(user_id: str, query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Lightweight precedent finder: search 'file_records' and 'messages' text for the query.
    For stronger results, replace with vector store + embedding search.
    """
    if db is None:
        return []

    q = {"$text": {"$search": query}} if False else {"$or": [
        {"original_name": {"$regex": query, "$options": "i"}},
        {"content": {"$regex": query, "$options": "i"}}
    ]}

    # search messages
    hits = []
    # messages that look like uploaded file system messages
    for m in db.get_collection("messages").find({"role": {"$in": ["system", "assistant", "user"]}, "content": {"$regex": query, "$options": "i"}}).limit(limit):
        hits.append({
            "source": "message",
            "content": m["content"][:1000],
            "conv_id": str(m.get("conv_id")),
            "timestamp": m.get("timestamp")
        })

    # search files
    for f in db.get_collection("file_records").find({"original_name": {"$regex": query, "$options": "i"}}).limit(limit):
        hits.append({
            "source": "file",
            "original_name": f.get("original_name"),
            "conv_id": str(f.get("conv_id")) if f.get("conv_id") else None,
            "timestamp": f.get("timestamp")
        })

    return hits[:limit]


# -----------------------
# 6) Helper to produce jurisdiction note for prompts
# -----------------------
def make_jurisdiction_note(jurisdiction: str) -> str:
    if not jurisdiction:
        return ""
    if jurisdiction.lower() == "india":
        return "Consider Indian statutes and commonly accepted Indian drafting practices. Use INR where currency involved."
    if jurisdiction.lower() == "uk":
        return "Consider UK statutes and HMRC conventions."
    if jurisdiction.lower() == "usa":
        return "Consider US federal and state-level variations; default to federal unless state specified."
    return f"Consider laws and conventions of {jurisdiction}."

# -----------------------
# 7) Small util to render nice summary & metadata
# -----------------------
def make_summary_block(title: str, summary_text: str) -> str:
    return f"# {title}\n\n{summary_text}\n\n---\n"

# End of legal_engine.py

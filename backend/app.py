# backend/app.py
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask import request
from dotenv import load_dotenv
import os, uuid, time, urllib.parse, traceback
from bson.objectid import ObjectId
from flask import stream_with_context
import json
import time
# AI SDK import (Groq)
try:
    from groq import Groq
except Exception:
    Groq = None

# file utils and extractors
from pdf_utils import text_to_pdf
import fitz  # pymupdf
import docx
from pymongo import MongoClient

# Load environment
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
MONGODB_URI = os.getenv("MONGODB_URI", "")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")

# App init
app = Flask(__name__)
CORS(app, origins=[FRONTEND_ORIGIN])

# Validate Groq
if Groq is None:
    print("Warning: groq SDK not installed or import failed. Install and configure the groq package.")
else:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except Exception as e:
        print("Warning: could not initialize Groq client:", e)
        client = None

# Validate / connect Mongo (defensive)
mongo = None
db = None
chats = None
if MONGODB_URI:
    try:
        mongo = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        mongo.admin.command("ping")
        db = mongo.get_database("legalsathi")
        chats = db.get_collection("chats")
    except Exception as e:
        print("MongoDB connection warning:", e)
        mongo = db = chats = None
else:
    print("Warning: MONGODB_URI not provided. History will not be saved.")

# Prevent boolean truth testing error
if db is not None and chats is None:
    chats = db.get_collection("chats")


UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs("generated_pdfs", exist_ok=True)

# Basic GST calculation helper:
def calculate_gst(amount: float, rate_percent: float, inclusive=False, interstate=False):
    """
    Returns dict with base_amount, gst_amount, cgst, sgst, igst, total.
    - If inclusive=True, amount is GST-inclusive, we compute base and tax.
    - interstate=True -> IGST applied, else split into CGST/SGST halves.
    """
    r = float(rate_percent or 0.0)
    if inclusive:
        base = amount / (1 + r/100)
        gst_amount = amount - base
    else:
        base = amount
        gst_amount = base * r / 100.0

    if interstate:
        igst = gst_amount
        cgst = 0.0
        sgst = 0.0
    else:
        igst = 0.0
        cgst = gst_amount / 2.0
        sgst = gst_amount / 2.0

    total = base + gst_amount
    return {
        "base_amount": round(base, 2),
        "gst_amount": round(gst_amount, 2),
        "cgst": round(cgst, 2),
        "sgst": round(sgst, 2),
        "igst": round(igst, 2),
        "total_amount": round(total, 2),
        "rate_percent": r,
        "inclusive": inclusive,
        "interstate": interstate,
    }

# --- AI helper ---
def ask_ai(context, user_input):
    """
    Sends prompt to Groq model and returns text. Adjust model name if needed.
    """
    if client is None:
        print("AI client not configured.")
        return "⚠️ AI not configured. Please contact the admin."

    try:
        prompt = f"{context}\n\nUser Request:\n{user_input}"
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": "You are LegalSathi, an Indian AI legal assistant providing professional and lawful responses."},
                {"role": "user", "content": prompt},
            ],
            # timeout options if SDK supports them could be added
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        # log stacktrace to server logs
        print("Groq Error:", e)
        traceback.print_exc()
        return "⚠️ Sorry, something went wrong with the AI. Please try again later."


# --- File Text Extractors ---
def extract_pdf_text(filepath):
    text = ""
    with fitz.open(filepath) as pdf:
        for page in pdf:
            text += page.get_text("text") + "\n"
    return text.strip()


def extract_docx_text(filepath):
    doc = docx.Document(filepath)
    return "\n".join([p.text for p in doc.paragraphs])

# --- Conversation helpers ---
def create_conversation(user_id, title="New conversation"):
    conv = {
        "user_id": user_id,
        "title": title,
        "created_at": time.time(),
        "updated_at": time.time()
    }
    res = db.get_collection("conversations").insert_one(conv)
    conv["_id"] = str(res.inserted_id)
    return conv

def add_message(conv_id, role, content):
    msg = {
        "conv_id": ObjectId(conv_id),
        "role": role,
        "content": content,
        "timestamp": time.time()
    }
    db.get_collection("messages").insert_one(msg)

def build_context(conv_id, max_messages=12):
    """
    Returns list of dicts for system/user messages suitable to include with AI call.
    We'll include last N messages from the conversation.
    """
    msgs = list(db.get_collection("messages")
                .find({"conv_id": ObjectId(conv_id)})
                .sort("timestamp", -1)
                .limit(max_messages))
    msgs = list(reversed(msgs))
    # convert to simple list:
    return [{"role": m["role"], "content": m["content"]} for m in msgs]

def simulate_stream(text, chunk_size=30, delay=0.03):
    """
    Yield the text in small chunks (fallback if AI SDK has no streaming).
    chunk_size is characters per chunk.
    """
    i = 0
    while i < len(text):
        chunk = text[i:i+chunk_size]
        i += chunk_size
        time.sleep(delay)  # short pause so frontend gets streaming feel
        yield chunk


# --- Routes ---

@app.route("/api/gst/calc", methods=["POST"])
def api_gst_calc():
    """
    POST JSON:
      { "amount": 1000, "rate": 18, "inclusive": false, "interstate": false }
    Returns GST calculation details.
    """
    data = request.get_json(force=True)
    try:
        amount = float(data.get("amount", 0))
        rate = float(data.get("rate", 18))
        inclusive = bool(data.get("inclusive", False))
        interstate = bool(data.get("interstate", False))
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

    result = calculate_gst(amount, rate, inclusive=inclusive, interstate=interstate)
    return jsonify(result)

@app.route("/api/gst/tips")
def api_gst_tips():
    """
    Return a short, safe list of lawful GST/tax planning tips and resources.
    These are general pointers — not professional advice.
    """
    tips = [
        {
            "title": "Choose correct HSN/SAC & Invoice format",
            "description": "Use correct HSN/SAC codes and maintain tax invoices — critical for input tax credit claims."
        },
        {
            "title": "Claim Input Tax Credit (ITC) properly",
            "description": "Maintain GST-compliant invoices and reconcile GSTR2B/2A to avoid blocked credits. Check composition scheme thresholds before opting in."
        },
        {
            "title": "Composition scheme vs regular registration",
            "description": "Small businesses may opt for composition (lower compliance) but composition dealers cannot claim ITC — choose based on business model."
        },
        {
            "title": "Keep records for 6 years",
            "description": "Maintain invoices, E-way bills and GST returns for statutory retention (subject to updates in law)."
        },
        {
            "title": "When in doubt, consult a CA",
            "description": "GST law is complex; for planning/loopholes consult a qualified Chartered Accountant — our tips are educational only."
        },
    ]
    return jsonify(tips)
@app.route("/")
def home():
    return "⚖️ LegalSathi backend active"
@app.route("/api/stream_chat", methods=["POST"])
def stream_chat():
    """
    Streams assistant reply as JSON lines.
    Fully fixed version — stable, works with Groq + your frontend.
    """
    try:
        data = request.get_json(force=True)
        user_id = data.get("user_id")
        message = (data.get("message") or "").strip()
        conv_id = data.get("conv_id")

        if not user_id or not message:
            return jsonify({"error": "Missing user_id or message"}), 400

        # -------------------------
        # 1. VALIDATE / CREATE CONVERSATION
        # -------------------------
        if not conv_id:
            conv = create_conversation(
                user_id,
                title=message[:50] or "Conversation"
            )
            conv_id = str(conv["_id"])
        else:
            conv_doc = db.get_collection("conversations").find_one(
                {"_id": ObjectId(conv_id)}
            )
            if not conv_doc or conv_doc.get("user_id") != user_id:
                return jsonify({"error": "Invalid conversation ID"}), 403

        # Save user message
        add_message(conv_id, "user", message)

        # -------------------------
        # 2. BUILD CONTEXT
        # -------------------------
        context_msgs = build_context(conv_id, max_messages=12)

        # -------------------------
        # 3. PICK SYSTEM PROMPT
        # -------------------------
        lower = message.lower()
        if any(x in lower for x in ["agreement", "contract", "draft"]):
            system_prompt = (
                "Draft a detailed Indian legal agreement with clear clauses, parties, "
                "duration, payment terms, liabilities, termination, and governing law. "
                "Use professional Indian legal language."
            )
        elif any(x in lower for x in ["summarize", "highlight", "summary"]):
            system_prompt = (
                "Summarize this Indian legal document and highlight the main points, "
                "obligations, deadlines, and risks."
            )
        else:
            system_prompt = (
                "You are LegalSathi, a professional Indian legal assistant. "
                "Explain clearly, avoid hallucinations, and follow Indian law."
            )

        messages_for_ai = [{"role": "system", "content": system_prompt}]
        messages_for_ai.extend(context_msgs)
        messages_for_ai.append({"role": "user", "content": message})

        # -------------------------
        # 4. STREAMING GENERATOR
        # -------------------------
        def generate():
            final_text = ""

            try:
                # real Groq streaming
                for chunk in client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=messages_for_ai,
                    stream=True
                ):
                    delta = (
                        chunk.choices[0].delta.get("content")
                        if chunk.choices and chunk.choices[0].delta
                        else ""
                    )

                    if delta:
                        final_text += delta
                        yield json.dumps({"chunk": delta}) + "\n"

            except Exception as stream_err:
                print("Streaming failed → fallback:", stream_err)

                try:
                    # fallback: full completion
                    completion = client.chat.completions.create(
                        model="llama-3.1-8b-instant",
                        messages=messages_for_ai,
                        stream=False
                    )
                    final_text = completion.choices[0].message.content.strip()

                    # simulate stream
                    for ch in simulate_stream(final_text):
                        yield json.dumps({"chunk": ch}) + "\n"

                except Exception as fatal:
                    print("FATAL AI ERROR:", fatal)
                    yield json.dumps({"error": "AI error"}) + "\n"
                    final_text = "[AI Error]"
            
            # -------------------------
            # Save final reply
            # -------------------------
            try:
                add_message(conv_id, "assistant", final_text)
                db.get_collection("conversations").update_one(
                    {"_id": ObjectId(conv_id)},
                    {"$set": {
                        "updated_at": time.time(),
                        "title": (final_text[:80] or "Conversation")
                    }}
                )
            except Exception as e:
                print("Failed to save assistant message:", e)

            # Final signal
            yield json.dumps({"done": True, "conv_id": conv_id}) + "\n"

        # return streaming response
        return Response(
            stream_with_context(generate()),
            mimetype="text/plain; charset=utf-8"
        )

    except Exception as e:
        print("stream_chat error:", e)
        traceback.print_exc()
        return jsonify({"error": "internal server error"}), 500

@app.route("/api/conversations/<user_id>")
def get_conversations(user_id):
    try:
        convs = list(db.get_collection("conversations").find({"user_id": user_id}).sort("updated_at", -1))
        for c in convs:
            c["_id"] = str(c["_id"])
        return jsonify(convs)
    except Exception as e:
        print("get_conversations error:", e)
        return jsonify([])

@app.route("/api/conversation/<conv_id>")
def get_conversation(conv_id):
    try:
        msgs = list(db.get_collection("messages").find({"conv_id": ObjectId(conv_id)}).sort("timestamp", 1))
        out = []
        for m in msgs:
            m["_id"] = str(m["_id"])
            m["conv_id"] = str(m["conv_id"])
            out.append(m)
        return jsonify(out)
    except Exception as e:
        print("get_conversation error:", e)
        return jsonify([])

@app.route("/api/files/<user_id>")
def list_files(user_id):
    try:
        docs = list(db.get_collection("file_records").find({"user_id": user_id}).sort("timestamp", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return jsonify(docs)
    except Exception as e:
        print("list_files error:", e)
        return jsonify([])

@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json(force=True)
        user_id = data.get("user_id")
        message = data.get("message", "").strip()
        if not user_id or not message:
            return jsonify({"error": "Missing user_id or message"}), 400

        # ✅ STEP 1: Fetch recent chat history for context
        recent_messages = []
        if chats is not None:
            try:
                recent_messages = list(
                    chats.find({"user_id": user_id})
                    .sort("timestamp", -1)
                    .limit(5)
                )
                # reverse to chronological order
                recent_messages = list(reversed(recent_messages))
            except Exception as e:
                print("Chat history fetch error:", e)

        # ✅ STEP 2: Build conversation context dynamically
        history_context = ""
        for msg in recent_messages:
            history_context += f"\nUser: {msg.get('message', '')}\nAssistant: {msg.get('reply', '')}\n"

        msg_lower = message.lower()

        # ✅ STEP 3: Intelligent context selection (your same logic + GST logic)
        if any(word in msg_lower for word in ["gst", "tax", "taxes", "input credit", "itc", "turnover", "tax saving", "composition scheme"]):
            # GST / Tax-related queries
            context = (
                "You are LegalSathi — a professional Indian GST and tax assistant. "
                "When the user asks about GST, provide accurate calculations, lawful GST planning, and compliance guidance. "
                "If the user gives an amount and GST rate, calculate CGST/SGST or IGST depending on interstate or intrastate. "
                "Also provide lawful tax-saving ideas under Indian law (like 80C, 80D, or HRA), "
                "but clearly state that this is for informational purposes only and not professional advice."
            )
        elif "agreement" in msg_lower or "contract" in msg_lower or "draft" in msg_lower:
            context = (
                "Draft a detailed Indian legal agreement in numbered clauses. "
                "Each section must have a heading (e.g., 1. Parties, 2. Term, 3. Rent, 4. Obligations, 5. Termination, 6. Governing Law). "
                "End with signature lines for both parties. Use professional Indian legal language."
            )
        elif "summarize" in msg_lower or "highlight" in msg_lower or "key points" in msg_lower:
            context = (
                "Summarize this Indian legal document and highlight the main points, obligations, deadlines, and risks. "
                "Provide a short actionable summary and bullet highlights."
            )
        elif "law" in msg_lower or "act" in msg_lower or "explain" in msg_lower:
            context = (
                "Explain Indian legal laws and likely legal implications relevant to this text. "
                "Mention relevant acts, sections, and practical next steps for an advocate."
            )
        else:
            context = "Provide helpful Indian legal assistance:"

        # ✅ STEP 4: Merge chat history with user’s new message
        combined_prompt = (
            f"{context}\n\nConversation so far:\n{history_context}\n\n"
            f"User's new message:\n{message}\n\n"
            "Please continue the conversation naturally, referring to previous context when relevant. "
            "If the topic is GST or tax, provide step-by-step accurate calculations and lawful saving suggestions."
        )

        # ✅ STEP 5: Generate AI response using existing helper
        reply = ask_ai("", combined_prompt)

        # ✅ STEP 6: Save PDF as before
        pdf_filename = f"{uuid.uuid4().hex[:8]}.pdf"
        pdf_path = text_to_pdf(reply, pdf_filename)

        # ✅ STEP 7: Save chat record (same as your existing logic)
        try:
            if chats is not None:
                chats.insert_one({
                    "user_id": user_id,
                    "message": message,
                    "reply": reply,
                    "pdf": pdf_filename,
                    "timestamp": time.time(),
                })
        except Exception as e:
            print("Mongo save error:", e)

        # ✅ STEP 8: Return same structure as before
        return jsonify({
            "reply": reply,
            "pdf_url": f"/download/{pdf_filename}"
        })

    except Exception as e:
        print("API /api/chat error:", e)
        traceback.print_exc()
        return jsonify({"error": "Internal server error"}), 500

@app.route("/api/search/<user_id>")
def search_chats(user_id):
    """Search across user messages and replies"""
    try:
        q = request.args.get("q", "").strip()
        if not q:
            return jsonify([])
        if chats is None:
            return jsonify([])
        results = list(
            chats.find(
                {"user_id": user_id, "$text": {"$search": q}},
                {"score": {"$meta": "textScore"}}
            ).sort([("score", {"$meta": "textScore"})])
        )
        for r in results:
            r["_id"] = str(r["_id"])
        return jsonify(results)
    except Exception as e:
        print("API /api/search error:", e)
        return jsonify([])
@app.route("/api/upload", methods=["POST"])
def upload_file():
    try:
        user_id = request.form.get("user_id")
        task = request.form.get("task", "summarize")
        file = request.files.get("file")
        if not user_id or not file:
            return jsonify({"error": "Missing user_id or file"}), 400

        # Save uploaded file
        filename = f"{uuid.uuid4().hex}_{file.filename}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        # Extract text content
        lower = filename.lower()
        if lower.endswith(".pdf"):
            content = extract_pdf_text(filepath)
        elif lower.endswith(".docx"):
            content = extract_docx_text(filepath)
        elif lower.endswith(".txt"):
            with open(filepath, "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()
        else:
            return jsonify({"error": "Unsupported file type"}), 400

        # ✅ Detect file topic — GST / tax / financial vs generic
        text_preview = content[:2000].lower()
        if any(word in text_preview for word in [
            "gst", "goods and services tax", "cgst", "sgst", "igst", "input tax credit",
            "invoice", "turnover", "taxable value", "itc", "tax saving", "income tax", "tds"
        ]):
            # GST or tax-related content
            context = (
                "You are LegalSathi, a professional Indian GST and tax assistant. "
                "Analyze and summarize the uploaded GST or tax-related document. "
                "Identify key figures such as taxable value, GST rate, CGST/SGST/IGST components, "
                "and any compliance-related details (invoice number, date, supplier, buyer). "
                "Provide a lawful summary including potential ITC eligibility, filing notes, "
                "and common tax-saving insights — but clearly state this is for informational use only, "
                "not professional advice."
            )
        elif "agreement" in text_preview or "contract" in text_preview or "legal" in text_preview:
            # Legal document
            context = (
                "Summarize this legal document, highlighting important clauses, parties involved, "
                "rights, obligations, termination terms, and governing law. "
                "Explain in simple Indian legal English and mention key takeaways."
            )
        elif "research" in text_preview or "study" in text_preview or "paper" in text_preview:
            # Academic or article type
            context = (
                "Summarize this research or article logically. Highlight main ideas, results, "
                "methodology, and conclusions in clear simple points."
            )
        else:
            # Default — your original summarization logic
            if task == "summarize":
                context = (
                    "Summarize the uploaded document in clear, concise language. "
                    "Highlight key ideas, structure, important facts, and insights. "
                    "If it's a legal or business document, mention important terms or clauses, "
                    "but if it's any other type (research, article, notes, etc.), summarize naturally "
                    "without legal assumptions."
                )
            else:
                context = (
                    "Explain this document in simple terms, outlining the key points, sections, "
                    "and practical meaning for an average reader. Keep it factual and easy to read."
                )

        # ✅ Process content (trim for safety)
        content_trim = content[:8000]
        reply = ask_ai(context, content_trim)

        # ✅ Generate a downloadable PDF of AI reply
        filename_pdf = f"{uuid.uuid4().hex[:8]}.pdf"
        pdf_path = text_to_pdf(reply, filename_pdf)

        # ✅ Save chat record for user
        try:
            if chats is not None:
                chats.insert_one({
                    "user_id": user_id,
                    "file_name": file.filename,
                    "reply": reply,
                    "pdf": filename_pdf,
                    "timestamp": time.time(),
                })
        except Exception as e:
            print("Mongo save error:", e)

        # ✅ Save file record for Library (unchanged)
        try:
            db.get_collection("file_records").insert_one({
                "user_id": user_id,
                "original_name": file.filename,
                "stored_path": filepath,
                "pdf": filename_pdf,
                "timestamp": time.time()
            })
        except Exception as e:
            print("file_records insert error:", e)

        # ✅ Return AI reply and metadata
        return jsonify({
            "reply": reply,
            "pdf_url": f"/download/{filename_pdf}",
            "file_name": file.filename
        })

    except Exception as e:
        print("API /api/upload error:", e)
        traceback.print_exc()
        return jsonify({"error": "Internal server error"}), 500


@app.route("/download/<filename>")
def download(filename):
    path = os.path.join("generated_pdfs", filename)
    if os.path.exists(path):
        return send_file(path, as_attachment=True)
    return "File not found", 404


@app.route("/api/history/<user_id>")
def history(user_id):
    try:
        if chats is None:
            return jsonify([])
        docs = list(chats.find({"user_id": user_id}).sort("timestamp", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return jsonify(docs)
    except Exception as e:
        print("API /api/history error:", e)
        traceback.print_exc()
        return jsonify([])
    
@app.route("/api/library/<user_id>")
def library(user_id):
    """Return uploaded document summaries for that user"""
    try:
        if chats is None:
            return jsonify([])
        files = list(chats.find(
            {"user_id": user_id, "file_name": {"$exists": True}}
        ).sort("timestamp", -1))
        for f in files:
            f["_id"] = str(f["_id"])
        return jsonify(files)
    except Exception as e:
        print("API /api/library error:", e)
        traceback.print_exc()
        return jsonify([])

@app.route("/api/newchat/<user_id>", methods=["POST"])
def new_chat(user_id):
    """Create a new empty chat thread."""
    try:
        if chats is not None:
            chats.insert_one({
                "user_id": user_id,
                "message": "",
                "reply": "",
                "pdf": None,
                "timestamp": time.time(),
            })
        return jsonify({"status": "ok"})
    except Exception as e:
        print("API /api/newchat error:", e)
        traceback.print_exc()
        return jsonify({"error": "failed"}), 500


@app.route("/api/conversation/<conv_id>", methods=["DELETE"])
def delete_conversation(conv_id):
    try:
        db.get_collection("conversations").delete_one({"_id": ObjectId(conv_id)})
        db.get_collection("messages").delete_many({"conv_id": ObjectId(conv_id)})
        return jsonify({"status": "ok"})
    except Exception as e:
        print("delete_conversation error:", e)
        return jsonify({"error": "failed"}), 500

@app.errorhandler(500)
def internal_error(error):
    print("500 error:", error)
    return jsonify({"error": "Internal server error"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi backend is running on 0.0.0.0:{port}/")
    app.run(host="0.0.0.0", port=port)

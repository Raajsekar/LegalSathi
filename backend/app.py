# backend/app.py
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from dotenv import load_dotenv
import os, uuid, time, urllib.parse, traceback

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


# --- Routes ---
@app.route("/")
def home():
    return "⚖️ LegalSathi backend active"


@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json(force=True)
        user_id = data.get("user_id")
        message = data.get("message", "")
        if not user_id or not message:
            return jsonify({"error": "Missing user_id or message"}), 400

        msg_lower = message.lower()
        # improved context selection
        if "agreement" in msg_lower or "contract" in msg_lower or "draft" in msg_lower:
            context = "Draft a detailed Indian legal agreement with clear clauses, parties, duration, payment terms, liability, termination, and governing law. Use professional Indian legal language."
        elif "summarize" in msg_lower or "highlight" in msg_lower or "key points" in msg_lower:
            context = "Summarize this Indian legal document and highlight the main points, obligations, deadlines, and risks. Provide a short actionable summary and bullet highlights."
        elif "law" in msg_lower or "act" in msg_lower or "explain" in msg_lower:
            context = "Explain Indian legal laws and likely legal implications relevant to this text. Mention relevant acts, sections, and practical next steps for an advocate."
        else:
            context = "Provide helpful Indian legal assistance:"

        reply = ask_ai(context, message)

        # Save PDF
        pdf_filename = f"{uuid.uuid4().hex[:8]}.pdf"
        pdf_path = text_to_pdf(reply, pdf_filename)

        # Save chat to MongoDB (if configured)
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

        return jsonify({
            "reply": reply,
            "pdf_url": f"/download/{pdf_filename}"
        })
    except Exception as e:
        print("API /api/chat error:", e)
        traceback.print_exc()
        return jsonify({"error": "Internal server error"}), 500


@app.route("/api/upload", methods=["POST"])
def upload_file():
    try:
        user_id = request.form.get("user_id")
        task = request.form.get("task", "summarize")
        file = request.files.get("file")
        if not user_id or not file:
            return jsonify({"error": "Missing user_id or file"}), 400

        # Save file
        filename = f"{uuid.uuid4().hex}_{file.filename}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        # Extract text
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

        # Select context
        if task == "summarize":
            context = "Summarize this legal document clearly for an Indian audience and highlight main points and obligations."
        else:
            context = "Explain this legal document in plain language and list legal implications for Indian users."

        # Limit input length to keep costs predictable
        content_trim = content[:8000]
        reply = ask_ai(context, content_trim)

        filename_pdf = f"{uuid.uuid4().hex[:8]}.pdf"
        pdf_path = text_to_pdf(reply, filename_pdf)

        # Save chat / upload record
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

        return jsonify({
            "reply": reply,
            "pdf_url": f"/download/{filename_pdf}"
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



if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi backend is running on 0.0.0.0:{port}/")
    app.run(host="0.0.0.0", port=port)

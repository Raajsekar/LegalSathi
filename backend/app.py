from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from dotenv import load_dotenv
import os, uuid, time

# AI client import
try:
    from groq import Groq
except Exception:
    Groq = None

from pdf_utils import text_to_pdf
import fitz  # PyMuPDF
import docx
from pymongo import MongoClient

# Load environment variables
load_dotenv()

# --- Configuration ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
MONGODB_URI = os.getenv("MONGODB_URI", "")
ALLOWED_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")

# --- Initialize Flask ---
app = Flask(__name__)
CORS(app, origins=[ALLOWED_ORIGIN])

# --- Initialize Groq client ---
if Groq is None:
    print("⚠️ Groq SDK not installed or failed to import.")
else:
    client = Groq(api_key=GROQ_API_KEY)

# --- Initialize MongoDB ---
mongo = None
db = None
chats = None

if MONGODB_URI:
    try:
        mongo = MongoClient(MONGODB_URI)
        db = mongo["legalsathi"]
        chats = db["chats"]
        print("✅ MongoDB connected successfully.")
    except Exception as e:
        print("❌ MongoDB connection failed:", e)
else:
    print("⚠️ MONGODB_URI not provided. History/save features will not work.")

# --- File Folders ---
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs("generated_pdfs", exist_ok=True)


# --- AI helper ---
def ask_ai(context, user_input):
    if Groq is None:
        return "⚠️ AI SDK not configured on server. Contact admin."

    try:
        prompt = f"{context}\n\nUser Request:\n{user_input}"
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": "You are LegalSathi, an Indian AI legal assistant providing professional and lawful responses."},
                {"role": "user", "content": prompt},
            ],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("Groq Error:", e)
        return "⚠️ Sorry, something went wrong with the AI."


# --- File extractors ---
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
    data = request.get_json(force=True)
    user_id = data.get("user_id")
    message = data.get("message", "")
    if not user_id or not message:
        return jsonify({"error": "Missing user_id or message"}), 400

    msg_lower = message.lower()
    if "contract" in msg_lower:
        context = "Draft a detailed Indian legal contract:"
    elif "summarize" in msg_lower:
        context = "Summarize this Indian legal document clearly:"
    elif "explain" in msg_lower:
        context = "Explain this Indian legal clause in simple words:"
    else:
        context = "Provide helpful Indian legal assistance:"

    reply = ask_ai(context, message)
    pdf_filename = f"{uuid.uuid4().hex[:8]}.pdf"
    pdf_path = text_to_pdf(reply, pdf_filename)

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


@app.route("/api/upload", methods=["POST"])
def upload_file():
    user_id = request.form.get("user_id")
    task = request.form.get("task", "summarize")
    file = request.files.get("file")
    if not user_id or not file:
        return jsonify({"error": "Missing user_id or file"}), 400

    filename = f"{uuid.uuid4().hex}_{file.filename}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

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

    context = (
        "Summarize this legal document clearly for an Indian audience:"
        if task == "summarize"
        else "Explain this legal document in plain language for Indian users:"
    )

    reply = ask_ai(context, content[:6000])
    filename_pdf = f"{uuid.uuid4().hex[:8]}.pdf"
    pdf_path = text_to_pdf(reply, filename_pdf)

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


@app.route("/download/<filename>")
def download(filename):
    path = os.path.join("generated_pdfs", filename)
    if os.path.exists(path):
        return send_file(path, as_attachment=True)
    return "File not found", 404


@app.route("/api/history/<user_id>")
def history(user_id):
    if chats is None:
        return jsonify([])
    try:
        docs = list(chats.find({"user_id": user_id}).sort("timestamp", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return jsonify(docs)
    except Exception as e:
        print("History fetch error:", e)
        return jsonify([])


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)

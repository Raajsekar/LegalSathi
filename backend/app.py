# backend/app.py
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from dotenv import load_dotenv
import os, uuid, time, traceback, json
from bson.objectid import ObjectId
from bson.errors import InvalidId
from flask import stream_with_context
from pymongo import MongoClient
import fitz
import docx

# AI
try:
    from groq import Groq
except:
    Groq = None

from pdf_utils import text_to_pdf

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
MONGODB_URI = os.getenv("MONGODB_URI", "")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")

app = Flask(__name__)
CORS(app, origins=[FRONTEND_ORIGIN])

# Groq init
client = None
if Groq:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except Exception as e:
        print("Groq init error:", e)
        client = None

# DB init
mongo = None
db = None
if MONGODB_URI:
    try:
        mongo = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        mongo.admin.command("ping")
        db = mongo.get_database("legalsathi")
    except Exception as e:
        print("Mongo error:", e)
        db = None

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs("generated_pdfs", exist_ok=True)

def is_valid_objectid(v):
    try:
        ObjectId(v)
        return True
    except Exception:
        return False

# ----------------------------- AI Utility -----------------------------
def ask_ai(context, prompt):
    """
    Simple non-streaming fallback call to Groq (used only on fallback)
    Returns a short error string if AI not available.
    """
    if not prompt or not str(prompt).strip():
        return "⚠️ No input"
    if client is None:
        return "⚠️ AI not configured"

    sys = context.strip() if context else "You are LegalSathi."

    messages = [
        {"role": "system", "content": sys},
        {"role": "user", "content": str(prompt).strip()}
    ]

    try:
        res = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages
        )
        return res.choices[0].message.content.strip()
    except Exception as e:
        print("Groq error:", e)
        return "⚠️ AI error. Try again."

# -------------------------- File extractors ---------------------------
def extract_pdf_text(path):
    t = ""
    with fitz.open(path) as pdf:
        for p in pdf:
            t += p.get_text("text") + "\n"
    return t.strip()

def extract_docx_text(path):
    d = docx.Document(path)
    return "\n".join([p.text for p in d.paragraphs])

# -------------------------- Conversation helpers ----------------------
def create_conversation(user_id, title="New conversation"):
    """
    Create conversation safely. If DB is not available, return a local pseudo id.
    """
    conv = {
        "user_id": user_id,
        "title": title,
        "created_at": time.time(),
        "updated_at": time.time()
    }
    if db is None:
        conv["_id"] = f"local-{uuid.uuid4().hex}"
        return conv
    try:
        res = db.get_collection("conversations").insert_one(conv)
        conv["_id"] = str(res.inserted_id)
        return conv
    except Exception as e:
        print("create_conversation DB error:", e)
        conv["_id"] = f"local-{uuid.uuid4().hex}"
        return conv

def add_message(conv_id, role, content):
    """
    Save a message to messages collection. If DB unavailable, do nothing.
    conv_id may be a string local id or a 24-char hex.
    """
    if db is None:
        return None
    try:
        # If conv_id looks like ObjectId, convert
        if is_valid_objectid(conv_id):
            conv_oid = ObjectId(conv_id)
        else:
            conv_oid = conv_id  # keep as string (in case you store strings)
        msg = {
            "conv_id": conv_oid,
            "role": role,
            "content": content,
            "timestamp": time.time()
        }
        db.get_collection("messages").insert_one(msg)
    except Exception as e:
        print("add_message error (non-fatal):", e)

def build_context(conv_id, limit=12):
    """
    Return last `limit` messages converted to chat-style messages for AI.
    If DB missing, return empty list.
    """
    if db is None or not is_valid_objectid(conv_id):
        return []
    msgs = list(
        db.get_collection("messages")
        .find({"conv_id": ObjectId(conv_id)})
        .sort("timestamp", -1)
        .limit(limit)
    )
    msgs.reverse()
    return [{"role": m["role"], "content": m["content"]} for m in msgs]

def simulate_stream(text, size=30):
    i = 0
    while i < len(text):
        yield text[i:i+size]
        i += size
        time.sleep(0.03)

# ----------------------------- ROUTES ---------------------------------

@app.route("/")
def home():
    return "⚖️ LegalSathi backend active"

# -------------------------- STREAM CHAT -------------------------------
@app.route("/api/stream_chat", methods=["POST"])
def stream_chat():
    """
    Expects JSON:
    { "user_id": "...", "message": "...", "conv_id": null | "<id>" }
    Streams newline-delimited JSON chunks: {"chunk": "..."} and final {"done": True, "conv_id": "..."}
    """
    try:
        data = request.get_json(force=True)
        user_id = data.get("user_id")
        message = (data.get("message") or "").strip()
        conv_id = data.get("conv_id")

        if not user_id or not message:
            return jsonify({"error": "Missing fields"}), 400

        conv_doc = None

        # 1. VALIDATE / CREATE CONVERSATION
        if not conv_id or not is_valid_objectid(conv_id):
            conv = create_conversation(user_id, message[:50] or "Conversation")
            conv_id = conv["_id"]
            conv_doc = conv
        else:
            if db is not None:
                conv_doc = db.get_collection("conversations").find_one({"_id": ObjectId(conv_id)})
                if not conv_doc or conv_doc.get("user_id") != user_id:
                    return jsonify({"error": "Invalid conversation ID"}), 403
            else:
                # DB missing: allow local conv_id to proceed (no persistence)
                conv_doc = {"_id": conv_id, "user_id": user_id}

        # Save user message (best-effort)
        try:
            add_message(conv_id, "user", message)
        except Exception as e:
            print("Warning: add_message failed:", e)

        # Build context for AI
        context_msgs = build_context(conv_id)

        # choose system prompt based on message
        lower = message.lower()
        if "agreement" in lower or "contract" in lower or "draft" in lower:
            sys_prompt = "Draft a detailed Indian legal agreement with clear clauses, parties, duration, payment terms, liabilities, termination, and governing law. Use professional Indian legal language."
        elif "summarize" in lower or "highlight" in lower or "summary" in lower:
            sys_prompt = "Summarize this Indian legal document and highlight the main points, obligations, deadlines, and risks."
        else:
            sys_prompt = "You are LegalSathi, a professional Indian legal assistant. Explain clearly, avoid hallucinations, and follow Indian law."

        messages_for_ai = [{"role": "system", "content": sys_prompt}]
        messages_for_ai.extend(context_msgs)
        messages_for_ai.append({"role": "user", "content": message})

        # Trim large contexts defensively (simple character based trim)
        # Keep it conservative to avoid token errors
        joined_len = sum(len(m.get("content","")) for m in messages_for_ai)
        if joined_len > 7000:
            # drop earliest user messages until under threshold
            while joined_len > 7000 and len(messages_for_ai) > 2:
                removed = messages_for_ai.pop(1)
                joined_len = sum(len(m.get("content","")) for m in messages_for_ai)

        def generate():
            final = ""
            # Attempt streaming via Groq if available
            try:
                if client is None:
                    raise RuntimeError("Groq client not available")

                for chunk in client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=messages_for_ai,
                    stream=True
                ):
                    # chunk structure: choices[0].delta may contain {"content": "..."}
                    delta = ""
                    try:
                        if chunk and getattr(chunk, "choices", None):
                            ch = chunk.choices[0]
                            if ch and ch.delta:
                                delta = ch.delta.get("content", "") or ""
                        # fallback if SDK returns dict-like
                        if not delta and isinstance(chunk, dict):
                            # try safe access
                            delta = chunk.get("delta", {}).get("content", "") or ""
                    except Exception:
                        delta = ""

                    if delta:
                        final += delta
                        yield json.dumps({"chunk": delta}) + "\n"

            except Exception as stream_err:
                # streaming not available — fallback to blocking call + simulate stream
                print("Streaming failed/fallback:", stream_err)
                try:
                    final = ask_ai(sys_prompt, message)
                except Exception as e:
                    print("ask_ai failed:", e)
                    final = "[AI Error]"

                for c in simulate_stream(final):
                    yield json.dumps({"chunk": c}) + "\n"

            # Save assistant message (best-effort)
            try:
                add_message(conv_id, "assistant", final)
            except Exception as e:
                print("Warning: add_message (assistant) failed:", e)

            # Update conversation title/updated_at if possible
            try:
                if db is not None and is_valid_objectid(conv_id):
                    db.get_collection("conversations").update_one(
                        {"_id": ObjectId(conv_id)},
                        {"$set": {"updated_at": time.time(), "title": (final[:80] or "Conversation")}}
                    )
            except Exception as e:
                print("Warning: update conversation title failed:", e)

            # final signal includes conv_id so frontend can replace local id
            yield json.dumps({"done": True, "conv_id": conv_id}) + "\n"

        return Response(stream_with_context(generate()), mimetype="text/plain; charset=utf-8")

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "internal error"}), 500

# -------------------------- FETCH CONVERSATION LIST ------------------------
@app.route("/api/conversations/<user_id>")
def get_conversations(user_id):
    """
    Return list of conversations for a user.
    Adds lightweight preview 'last_message' for sidebar convenience.
    """
    try:
        if db is None:
            return jsonify([])

        convs = list(
            db.get_collection("conversations")
            .find({"user_id": user_id})
            .sort("updated_at", -1)
        )
        out = []
        for c in convs:
            c_id = str(c["_id"])
            # fetch last message (if any)
            last_msg_doc = db.get_collection("messages").find_one(
                {"conv_id": ObjectId(c_id)},
                sort=[("timestamp", -1)]
            )
            last_message = last_msg_doc["content"] if last_msg_doc else ""
            out.append({
                "_id": c_id,
                "title": c.get("title", "") or "Untitled",
                "created_at": c.get("created_at"),
                "updated_at": c.get("updated_at"),
                "last_message": last_message
            })
        return jsonify(out)
    except Exception as e:
        print("get_conversations error:", e)
        return jsonify([])

# -------------------------- FETCH CONVERSATION MESSAGES ------------------------
@app.route("/api/conversation/<conv_id>")
def get_conversation(conv_id):
    """
    Return list of messages for a conversation in chronological order.
    """
    try:
        if db is None:
            return jsonify([])

        if not is_valid_objectid(conv_id):
            return jsonify([])

        msgs = list(
            db.get_collection("messages")
            .find({"conv_id": ObjectId(conv_id)})
            .sort("timestamp", 1)
        )
        out = []
        for m in msgs:
            out.append({
                "_id": str(m.get("_id")),
                "role": m.get("role"),
                "content": m.get("content"),
                "timestamp": m.get("timestamp")
            })
        return jsonify(out)
    except Exception as e:
        print("get_conversation error:", e)
        return jsonify([])

# --------------------------- FILE UPLOAD -------------------------------
@app.route("/api/upload", methods=["POST"])
def upload_file():
    try:
        user_id = request.form.get("user_id")
        task = request.form.get("task", "summarize")
        file = request.files.get("file")

        if not user_id or not file:
            return jsonify({"error": "Missing fields"}), 400

        filename = f"{uuid.uuid4().hex}_{file.filename}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        # extract text
        lower = filename.lower()
        if lower.endswith(".pdf"):
            content = extract_pdf_text(filepath)
        elif lower.endswith(".docx"):
            content = extract_docx_text(filepath)
        elif lower.endswith(".txt"):
            content = open(filepath, "r", encoding="utf8", errors="ignore").read()
        else:
            return jsonify({"error": "Unsupported file type"}), 400

        context = "Summarize clearly."
        reply = ask_ai(context, content[:8000])

        pdfname = f"{uuid.uuid4().hex[:8]}.pdf"
        text_to_pdf(reply, pdfname)

        # save file record (best-effort)
        try:
            if db is not None:
                db.get_collection("file_records").insert_one({
                    "user_id": user_id,
                    "original_name": file.filename,
                    "stored_path": filepath,
                    "pdf": pdfname,
                    "timestamp": time.time()
                })
        except Exception as e:
            print("file_records insert error:", e)

        return jsonify({
            "reply": reply,
            "pdf_url": f"/download/{pdfname}"
        })

    except Exception as e:
        print("upload error:", e)
        traceback.print_exc()
        return jsonify({"error": "internal error"}), 500

# ----------------------------- DOWNLOAD --------------------------------
@app.route("/download/<filename>")
def download(filename):
    path = os.path.join("generated_pdfs", filename)
    if os.path.exists(path):
        return send_file(path, as_attachment=True)
    return "Not Found", 404

# -------------------------- DELETE CONVERSATION -------------------------
@app.route("/api/conversation/<conv_id>", methods=["DELETE"])
def delete_conversation(conv_id):
    try:
        # If no DB, just return ok (client will remove locally)
        if db is None:
            return jsonify({"status": "ok", "note": "no-db"}), 200

        # delete messages referencing this conv
        try:
            db.get_collection("messages").delete_many({"conv_id": ObjectId(conv_id)})
        except Exception:
            # some stores might have stored conv_id as string
            db.get_collection("messages").delete_many({"conv_id": conv_id})

        # delete conversation entry
        db.get_collection("conversations").delete_one({"_id": ObjectId(conv_id)})

        # optional: delete any file_records pointing to this conv (if you keep linkage)
        try:
            db.get_collection("file_records").delete_many({"conv_id": ObjectId(conv_id)})
        except Exception:
            pass

        return jsonify({"status": "deleted"}), 200
    except Exception as e:
        print("delete_conversation error:", e)
        return jsonify({"error": "delete failed"}), 500

# ------------------------------- MAIN ----------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🔥 Running on {port}")
    app.run(host="0.0.0.0", port=port)

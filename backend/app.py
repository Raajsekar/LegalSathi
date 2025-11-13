# backend/app.py
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from dotenv import load_dotenv
import os, uuid, time, traceback, json
from bson.objectid import ObjectId
from flask import stream_with_context
from pymongo import MongoClient

# AI SDK import (Groq)
try:
    from groq import Groq
except Exception:
    Groq = None

# file utils
from pdf_utils import text_to_pdf
import fitz
import docx

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
MONGODB_URI = os.getenv("MONGODB_URI", "")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")

app = Flask(__name__)
CORS(app, origins=[FRONTEND_ORIGIN])

# Groq client (optional)
client = None
if Groq is not None and GROQ_API_KEY:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except Exception as e:
        print("Groq init error:", e)
        client = None

# Mongo
mongo = None
db = None
if MONGODB_URI:
    try:
        mongo = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        mongo.admin.command("ping")
        db = mongo.get_database("legalsathi")
    except Exception as e:
        print("mongo connect failed:", e)
        db = None
else:
    print("MONGODB_URI not set; DB disabled.")

# ensure collections
if db:
    conversations_col = db.get_collection("conversations")
    messages_col = db.get_collection("messages")
    file_records_col = db.get_collection("file_records")
else:
    conversations_col = messages_col = file_records_col = None

# --- helpers ---
def create_conversation(user_id, title="New conversation"):
    conv = {
        "user_id": user_id,
        "title": title,
        "created_at": time.time(),
        "updated_at": time.time(),
        "snippet": ""
    }
    if conversations_col:
        res = conversations_col.insert_one(conv)
        conv["_id"] = str(res.inserted_id)
    else:
        conv["_id"] = f"local-{int(time.time()*1000)}"
    return conv

def add_message(conv_id, role, content):
    if not messages_col:
        return
    msg = {
        "conv_id": ObjectId(conv_id),
        "role": role,
        "content": content,
        "timestamp": time.time()
    }
    messages_col.insert_one(msg)
    # update conversation snippet and updated_at
    try:
        snippet = (content[:120] + "...") if len(content) > 120 else content
        conversations_col.update_one({"_id": ObjectId(conv_id)}, {"$set": {"updated_at": time.time(), "snippet": snippet}})
    except Exception:
        pass

def build_context(conv_id, max_messages=12):
    if not messages_col:
        return []
    msgs = list(messages_col.find({"conv_id": ObjectId(conv_id)}).sort("timestamp", -1).limit(max_messages))
    msgs = list(reversed(msgs))
    return [{"role": m["role"], "content": m["content"]} for m in msgs]

def ask_ai(system_context, user_input):
    if client is None:
        print("AI not configured")
        return "⚠️ AI not configured. Please contact admin."
    try:
        prompt = f"{system_context}\n\nUser Request:\n{user_input}"
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": "You are LegalSathi, an Indian AI legal assistant."},
                {"role": "user", "content": prompt},
            ],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("ask_ai error:", e)
        traceback.print_exc()
        return "⚠️ Sorry, AI error."

def simulate_stream(text, chunk_size=40, delay=0.02):
    i = 0
    while i < len(text):
        chunk = text[i:i+chunk_size]
        i += chunk_size
        time.sleep(delay)
        yield chunk

# --- endpoints ---
@app.route("/api/conversations/<user_id>")
def get_conversations(user_id):
    try:
        if not conversations_col:
            return jsonify([])
        convs = list(conversations_col.find({"user_id": user_id}).sort("updated_at", -1))
        out = []
        for c in convs:
            c["_id"] = str(c["_id"])
            out.append({
                "_id": c["_id"],
                "title": c.get("title", "Conversation"),
                "snippet": c.get("snippet", "")
            })
        return jsonify(out)
    except Exception as e:
        print("get_conversations error:", e)
        return jsonify([])

@app.route("/api/conversation/<conv_id>")
def get_conversation(conv_id):
    try:
        if not messages_col:
            return jsonify([])
        msgs = list(messages_col.find({"conv_id": ObjectId(conv_id)}).sort("timestamp", 1))
        out = []
        for m in msgs:
            out.append({
                "_id": str(m["_id"]),
                "role": m["role"],
                "content": m["content"],
                "timestamp": m["timestamp"]
            })
        return jsonify(out)
    except Exception as e:
        print("get_conversation error:", e)
        return jsonify([])

@app.route("/api/newchat/<user_id>", methods=["POST"])
def new_chat(user_id):
    try:
        conv = create_conversation(user_id, title="New conversation")
        return jsonify({"status": "ok", "conv_id": conv["_id"]})
    except Exception as e:
        print("new_chat error:", e)
        return jsonify({"error": "failed"}), 500

@app.route("/api/stream_chat", methods=["POST"])
def stream_chat():
    try:
        data = request.get_json(force=True)
        user_id = data.get("user_id")
        message = data.get("message", "").strip()
        conv_id = data.get("conv_id")  # may be None

        if not user_id or not message:
            return jsonify({"error": "missing"}), 400

        # create conversation if needed
        if not conv_id:
            conv = create_conversation(user_id, title=message[:80] or "Conversation")
            conv_id = conv["_id"]
        else:
            # verify ownership
            try:
                conv_doc = conversations_col.find_one({"_id": ObjectId(conv_id)})
                if conv_doc and conv_doc.get("user_id") != user_id:
                    return jsonify({"error": "invalid conv"}), 403
            except Exception:
                return jsonify({"error": "invalid conv id"}), 400

        # save user message
        try:
            add_message(conv_id, "user", message)
        except Exception as e:
            print("warning saving user message", e)

        # build context
        ctx_msgs = build_context(conv_id, max_messages=12)

        # pick system prompt based on message content (simple heuristics)
        msg_lower = message.lower()
        if any(k in msg_lower for k in ["contract", "agreement", "draft"]):
            sys_prompt = "Draft a detailed Indian legal agreement in numbered clauses..."
        elif any(k in msg_lower for k in ["summarize", "key points", "highlight"]):
            sys_prompt = "Summarize this legal document and highlight main points..."
        else:
            sys_prompt = "You are LegalSathi, an Indian legal assistant."

        # prepare messages for AI (system + convo history + user)
        messages_for_ai = [{"role": "system", "content": sys_prompt}]
        messages_for_ai.extend(ctx_msgs)
        messages_for_ai.append({"role": "user", "content": message})

        def generate():
            final_text = ""
            # Try streaming via SDK if available
            try:
                if client is not None and hasattr(client.chat.completions, "stream"):
                    for event in client.chat.completions.stream(model="llama-3.1-8b-instant", messages=messages_for_ai):
                        # event may contain delta text
                        chunk_text = getattr(event, "delta", "") or str(event)
                        yield json.dumps({"chunk": chunk_text}) + "\n"
                        final_text += chunk_text
                else:
                    # blocking call then stream simulated chunks
                    if client is not None:
                        completion = client.chat.completions.create(model="llama-3.1-8b-instant", messages=messages_for_ai)
                        final_text = completion.choices[0].message.content.strip()
                        for c in simulate_stream(final_text):
                            yield json.dumps({"chunk": c}) + "\n"
                    else:
                        # fallback to simple ask_ai helper (which also calls SDK if configured)
                        final_text = ask_ai(sys_prompt, message)
                        for c in simulate_stream(final_text):
                            yield json.dumps({"chunk": c}) + "\n"
            except Exception as e:
                # last resort: compute via ask_ai
                try:
                    final_text = ask_ai(sys_prompt, message)
                    for c in simulate_stream(final_text):
                        yield json.dumps({"chunk": c}) + "\n"
                except Exception as e2:
                    print("stream error", e2)
                    yield json.dumps({"error": "AI error"}) + "\n"
            # save assistant message
            try:
                add_message(conv_id, "assistant", final_text)
                # update conversation title/snippet
                try:
                    conversations_col.update_one({"_id": ObjectId(conv_id)}, {"$set": {"updated_at": time.time(), "title": final_text[:80], "snippet": final_text[:120]}})
                except Exception:
                    pass
            except Exception as e:
                print("save assistant msg error", e)
            # final marker with conv_id
            yield json.dumps({"done": True, "conv_id": conv_id}) + "\n"

        return Response(stream_with_context(generate()), mimetype="text/plain; charset=utf-8")
    except Exception as e:
        print("stream_chat outer error:", e)
        traceback.print_exc()
        return jsonify({"error": "internal"}), 500

# non-streaming chat (fallback)
@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json(force=True)
        user_id = data.get("user_id")
        message = data.get("message", "").strip()
        conv_id = data.get("conv_id") or None
        if not user_id or not message:
            return jsonify({"error": "missing"}), 400

        if not conv_id:
            conv = create_conversation(user_id, title=message[:80])
            conv_id = conv["_id"]

        add_message(conv_id, "user", message)

        # build context & system prompt (reuse logic)
        ctx_msgs = build_context(conv_id, max_messages=12)
        msg_lower = message.lower()
        if any(k in msg_lower for k in ["contract", "agreement", "draft"]):
            sys_prompt = "Draft a detailed Indian legal agreement in numbered clauses..."
        elif any(k in msg_lower for k in ["summarize", "key points", "highlight"]):
            sys_prompt = "Summarize this legal document and highlight main points..."
        else:
            sys_prompt = "You are LegalSathi, an Indian legal assistant."

        messages_for_ai = [{"role": "system", "content": sys_prompt}]
        messages_for_ai.extend(ctx_msgs)
        messages_for_ai.append({"role": "user", "content": message})

        # ask AI (blocking)
        reply = ask_ai(sys_prompt, message)

        add_message(conv_id, "assistant", reply)
        # update conv snippet
        if conversations_col:
            conversations_col.update_one({"_id": ObjectId(conv_id)}, {"$set": {"updated_at": time.time(), "snippet": reply[:120]}})

        # create downloadable pdf
        filename_pdf = f"{uuid.uuid4().hex[:8]}.pdf"
        text_to_pdf(reply, filename_pdf)

        return jsonify({"reply": reply, "conv_id": conv_id, "pdf_url": f"/download/{filename_pdf}"})
    except Exception as e:
        print("chat error", e)
        traceback.print_exc()
        return jsonify({"error": "internal"}), 500

# file upload endpoint (uses ask_ai on file content)
@app.route("/api/upload", methods=["POST"])
def upload_file():
    try:
        user_id = request.form.get("user_id")
        task = request.form.get("task", "summarize")
        file = request.files.get("file")
        if not user_id or not file:
            return jsonify({"error": "missing"}), 400

        filename = f"{uuid.uuid4().hex}_{file.filename}"
        path = os.path.join("uploads", filename)
        os.makedirs("uploads", exist_ok=True)
        file.save(path)

        content = ""
        lower = file.filename.lower()
        if lower.endswith(".pdf"):
            text = ""
            with fitz.open(path) as pdf:
                for p in pdf:
                    text += p.get_text("text") + "\n"
            content = text
        elif lower.endswith(".docx"):
            doc = docx.Document(path)
            content = "\n".join([p.text for p in doc.paragraphs])
        else:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read()

        content_trim = content[:8000]
        # simple context selection
        if "gst" in content_trim.lower():
            sys_prompt = "You are a GST assistant..."
        else:
            sys_prompt = "Summarize the document..."

        reply = ask_ai(sys_prompt, content_trim)

        # save as conversation + messages
        conv = create_conversation(user_id, title=file.filename[:80])
        add_message(conv["_id"], "user", f"Uploaded file: {file.filename}")
        add_message(conv["_id"], "assistant", reply)

        # save file record
        if file_records_col:
            file_records_col.insert_one({"user_id": user_id, "original_name": file.filename, "stored_path": path, "timestamp": time.time()})

        filename_pdf = f"{uuid.uuid4().hex[:8]}.pdf"
        text_to_pdf(reply, filename_pdf)
        return jsonify({"reply": reply, "conv_id": conv["_id"], "pdf_url": f"/download/{filename_pdf}"})
    except Exception as e:
        print("upload error", e)
        traceback.print_exc()
        return jsonify({"error": "internal"}), 500

@app.route("/download/<filename>")
def download(filename):
    path = os.path.join("generated_pdfs", filename)
    if os.path.exists(path):
        return send_file(path, as_attachment=True)
    return "Not found", 404

# minimal health
@app.route("/")
def home():
    return "LegalSathi backend OK"

if __name__ == "__main__":
    os.makedirs("generated_pdfs", exist_ok=True)
    port = int(os.environ.get("PORT", 10000))
    print(f"Starting on {port}")
    app.run(host="0.0.0.0", port=port)

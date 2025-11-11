from flask import Flask, request, Response, send_file
from twilio.twiml.messaging_response import MessagingResponse
from twilio.rest import Client as TwilioClient
from groq import Groq
import os, time
from dotenv import load_dotenv
from pdf_utils import text_to_pdf

# ================== SETUP ==================
load_dotenv()
app = Flask(__name__)

# Groq + Twilio
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
twilio_client = TwilioClient(
    os.getenv("TWILIO_ACCOUNT_SID"),
    os.getenv("TWILIO_AUTH_TOKEN")
)

TWILIO_WHATSAPP = "whatsapp:+14155238886"  # Twilio sandbox number
PDF_DIR = "generated_pdfs"
os.makedirs(PDF_DIR, exist_ok=True)
user_state = {}

# ================== AI HELPER ==================
def ask_ai(context, prompt):
    """Ask Groq Llama model and return response"""
    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system",
                 "content": "You are LegalSathi, an Indian AI legal assistant. Be clear, lawful, and professional."},
                {"role": "user", "content": f"{context}\n{prompt}"}
            ],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("Groq Error:", e)
        return "⚠️ Sorry, I couldn’t process that right now. Please try again later."

# ================== AUTO-MENU FUNCTION ==================
def get_menu():
    """Returns the main menu message"""
    return (
        "⚖️ *LegalSathi Main Menu*\n\n"
        "Choose what you'd like me to help with:\n"
        "1️⃣ Summarize a legal document\n"
        "2️⃣ Draft a contract or agreement\n"
        "3️⃣ Explain a legal clause\n\n"
        "_Reply with 1, 2, or 3._"
    )

def send_auto_menu(to_number):
    """Send proactive menu message to user"""
    try:
        twilio_client.messages.create(
            from_=TWILIO_WHATSAPP,
            to=to_number,
            body=get_menu()
        )
        print(f"✅ Auto menu sent to {to_number}")
    except Exception as e:
        print(f"⚠️ Failed to send auto menu: {e}")

# ================== HOMEPAGE ==================
@app.route("/")
def home():
    return """
    <html><body style='font-family:Arial;text-align:center;margin-top:80px'>
    <h1>⚖️ LegalSathi</h1>
    <p>Your Indian AI legal assistant on WhatsApp.</p>
    <p>Get instant help drafting, summarizing, or explaining legal documents.</p>
    </body></html>
    """

# ================== MAIN WHATSAPP LOGIC ==================
@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    sender = request.values.get("From", "")
    body = (request.values.get("Body") or "").strip()
    num_media = int(request.values.get("NumMedia", 0))
    print(f"📩 Message from {sender}: {body or '[empty]'} (media: {num_media})")

    resp = MessagingResponse()

    # === FIRST MESSAGE (New User or No State Saved) ===
    if sender not in user_state or not user_state[sender].get("stage"):
        user_state[sender] = {"stage": "menu"}
        welcome_text = (
            "👋 Hi there! I'm *LegalSathi*, your AI legal assistant.\n\n"
            "I can help you with the following:\n"
            "1️⃣ Summarize a legal document\n"
            "2️⃣ Draft a contract or agreement\n"
            "3️⃣ Explain a legal clause\n\n"
            "_Please reply with 1, 2, or 3 to begin._"
        )
        resp.message(welcome_text)
        print("📤 Sent welcome menu to new user.")
        return Response(str(resp), mimetype="application/xml")

    # === USER REQUESTS MENU / HI AGAIN ===
    if body.lower() in ["hi", "hello", "menu", "start", "hey"]:
        user_state[sender]["stage"] = "menu"
        resp.message(get_menu())
        print("📤 Displayed main menu again.")
        return Response(str(resp), mimetype="application/xml")

    stage = user_state[sender]["stage"]

    # === MENU SELECTION ===
    if stage == "menu":
        if body in ["1", "summarize", "summary"]:
            user_state[sender]["stage"] = "summarize"
            resp.message("📄 Please paste or upload the *legal document* you'd like summarized.")
        elif body in ["2", "contract", "agreement"]:
            user_state[sender]["stage"] = "contract"
            resp.message("✍️ Please describe the *contract or agreement* you'd like drafted (names, details, duration).")
        elif body in ["3", "explain", "clause"]:
            user_state[sender]["stage"] = "explain"
            resp.message("📘 Please paste the *legal clause or section* you'd like explained.")
        else:
            resp.message("⚠️ Invalid option. Reply with 1, 2, or 3.")
        return Response(str(resp), mimetype="application/xml")

    # === PROCESS SUMMARIZE / CONTRACT / EXPLAIN ===
    if stage in ["summarize", "contract", "explain"]:
        if num_media > 0:
            media_url = request.values.get("MediaUrl0")
            media_type = request.values.get("MediaContentType0")
            body += f"\n[User uploaded {media_type}: {media_url}]"
            print(f"📎 Media received: {media_url}")

        context = {
            "summarize": "Summarize this legal document in clear Indian English.",
            "contract": "Draft a professional Indian legal contract based on this request.",
            "explain": "Explain this legal clause in simple, clear terms.",
        }[stage]

        print(f"🧠 Processing {stage} request for {sender}...")
        ai_reply = ask_ai(context, body)

        # Save PDF
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 PDF saved: {pdf_path}")

        # Split long messages
        max_len = 1500
        for i in range(0, len(ai_reply), max_len):
            resp.message(ai_reply[i:i+max_len])

        resp.message("✅ Task completed successfully!\n\n📎 Type *pdf* to download your document.\n\n" + get_menu())
        user_state[sender]["stage"] = "menu"
        return Response(str(resp), mimetype="application/xml")

    # === PDF DOWNLOAD ===
    if body.lower() == "pdf":
        pdf_files = [f for f in os.listdir(PDF_DIR) if f.endswith(".pdf")]
        if pdf_files:
            latest = max(pdf_files, key=lambda f: os.path.getctime(os.path.join(PDF_DIR, f)))
            return send_file(os.path.join(PDF_DIR, latest), as_attachment=True)
        else:
            resp.message("⚠️ No document found. Please complete a task first.")
            return Response(str(resp), mimetype="application/xml")

    # === FALLBACK ===
    resp.message("🤖 I didn’t understand. Type *menu* to see options again.")
    return Response(str(resp), mimetype="application/xml")

# ================== RUN FLASK SERVER ==================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi running on http://0.0.0.0:{port}/whatsapp")
    app.run(host="0.0.0.0", port=port)

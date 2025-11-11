from flask import Flask, request, Response, send_file
from twilio.twiml.messaging_response import MessagingResponse
from twilio.rest import Client as TwilioClient
from groq import Groq
import os, time
from dotenv import load_dotenv
from pdf_utils import text_to_pdf

# ========== Setup ==========
load_dotenv()
app = Flask(__name__)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
user_state = {}
PDF_DIR = "generated_pdfs"
os.makedirs(PDF_DIR, exist_ok=True)

# Twilio credentials (for proactive message)
twilio_client = TwilioClient(
    os.getenv("TWILIO_ACCOUNT_SID"),
    os.getenv("TWILIO_AUTH_TOKEN")
)
TWILIO_WHATSAPP = "whatsapp:+14155238886"  # Twilio sandbox number

# ========== AI helper ==========
def ask_ai(context, prompt):
    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": "You are LegalSathi, an Indian AI legal assistant. Be professional, lawful, and helpful.",
                },
                {"role": "user", "content": f"{context}\n{prompt}"},
            ],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("Groq Error:", e)
        return "⚠️ Sorry, I couldn’t process that right now. Please try again later."


# ========== Send proactive welcome ==========
def send_welcome_message(to_number):
    """Send initial greeting proactively to new users."""
    welcome = (
        "👋 *Welcome to LegalSathi!*\n\n"
        "I can help you with:\n"
        "1️⃣ Summarize a legal document\n"
        "2️⃣ Draft a contract or agreement\n"
        "3️⃣ Explain a legal clause\n\n"
        "_Reply with 1, 2, or 3 to continue._"
    )
    try:
        twilio_client.messages.create(
            from_=TWILIO_WHATSAPP,
            to=to_number,
            body=welcome
        )
        print(f"✅ Auto menu sent to {to_number}")
    except Exception as e:
        print(f"⚠️ Failed to send welcome to {to_number}: {e}")


# ========== Homepage ==========
@app.route("/")
def home():
    return """
    <html><body style='font-family:Arial;text-align:center;margin-top:80px'>
    <h1>⚖️ LegalSathi</h1>
    <p>Indian AI Legal Assistant available on WhatsApp.</p>
    <p>Helps you summarize documents, draft contracts, and explain legal terms.</p>
    </body></html>
    """


# ========== WhatsApp webhook ==========
@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    sender = request.values.get("From", "")
    body = (request.values.get("Body") or "").strip()
    num_media = int(request.values.get("NumMedia", 0))
    print(f"📩 {sender}: {body or '[no text]'} (media: {num_media})")

    resp = MessagingResponse()

    # === First-time user: auto send welcome menu ===
    if sender not in user_state:
        user_state[sender] = {"stage": "menu"}
        send_welcome_message(sender)
        resp.message("👋 Welcome to LegalSathi! Check your WhatsApp inbox for options.")
        return Response(str(resp), mimetype="application/xml")

    # === Menu navigation ===
    stage = user_state[sender]["stage"]

    # If user types menu again
    if body.lower() in ["menu", "hi", "hello", "start", "restart"]:
        user_state[sender]["stage"] = "menu"
        send_welcome_message(sender)
        return Response(str(resp), mimetype="application/xml")

    # === Handle menu selections ===
    if stage == "menu":
        if body in ["1", "summarize", "summary"]:
            user_state[sender]["stage"] = "summarize"
            resp.message("📄 Please paste your *legal document text or link*, or upload the file to summarize.")
            return Response(str(resp), mimetype="application/xml")
        elif body in ["2", "contract", "agreement"]:
            user_state[sender]["stage"] = "contract"
            resp.message("✍️ Describe the *contract or agreement* you'd like drafted (parties, duration, etc).")
            return Response(str(resp), mimetype="application/xml")
        elif body in ["3", "explain", "clause"]:
            user_state[sender]["stage"] = "explain"
            resp.message("📘 Paste the *legal clause or section* you want explained.")
            return Response(str(resp), mimetype="application/xml")
        else:
            resp.message("⚠️ Invalid option. Reply with 1, 2, or 3.")
            return Response(str(resp), mimetype="application/xml")

    # === Handle uploads / messages for active stage ===
    if stage in ["summarize", "contract", "explain"]:
        # If user sends a document/media
        if num_media > 0:
            media_url = request.values.get("MediaUrl0")
            media_type = request.values.get("MediaContentType0")
            body += f"\n[User uploaded {media_type}: {media_url}]"
            print(f"📎 Media received: {media_url}")

        # Now handle based on stage
        if stage == "summarize":
            ai_reply = ask_ai("Summarize this legal document in clear Indian English:", body)
        elif stage == "contract":
            ai_reply = ask_ai("Draft a professional Indian contract:", body)
        else:
            ai_reply = ask_ai("Explain this legal clause simply:", body)

        # Save to PDF
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 PDF saved at {pdf_path}")

        # Split message for WhatsApp limits
        max_len = 1500
        for i in range(0, len(ai_reply), max_len):
            resp.message(ai_reply[i:i+max_len])
        resp.message("📎 Type *pdf* to download this document.\n⚖️ Type *menu* for main options.")

        user_state[sender]["stage"] = "menu"
        return Response(str(resp), mimetype="application/xml")

    # === Send PDF ===
    if body.lower() == "pdf":
        pdf_files = [f for f in os.listdir(PDF_DIR) if f.endswith(".pdf")]
        if pdf_files:
            latest = max(pdf_files, key=lambda f: os.path.getctime(os.path.join(PDF_DIR, f)))
            return send_file(os.path.join(PDF_DIR, latest), as_attachment=True)
        else:
            resp.message("⚠️ No document found. Please generate one first.")
            return Response(str(resp), mimetype="application/xml")

    # === Fallback ===
    resp.message("🤖 Type *menu* to see options again.")
    return Response(str(resp), mimetype="application/xml")


# ========== Run ==========
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi running on 0.0.0.0:{port}/whatsapp")
    app.run(host="0.0.0.0", port=port)

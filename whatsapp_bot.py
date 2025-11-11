from flask import Flask, request, Response, send_file
from twilio.twiml.messaging_response import MessagingResponse
from groq import Groq
import os
from dotenv import load_dotenv
from pdf_utils import text_to_pdf
import time

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)

# Initialize Groq client
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# ================== AI HELPER FUNCTION ==================
def ask_ai(context, user_input):
    try:
        prompt = f"{context}\n\nUser request:\n{user_input}"
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": "You are LegalSathi, an Indian AI legal assistant. Provide clear, lawful, and professional responses in Indian context."},
                {"role": "user", "content": prompt}
            ]
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("Groq Error:", e)
        return "⚠️ Sorry, I couldn’t process that right now. Please try again later."

# ================== USER CONTEXT STORAGE ==================
# (In production, replace this with Redis or a database)
user_state = {}

# ================== HOME ROUTE ==================
@app.route("/")
def home():
    return """
    <html>
        <head><title>LegalSathi - AI Legal Assistant</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 100px;">
            <h1>⚖️ LegalSathi</h1>
            <p>Your AI-powered Indian legal assistant, available 24/7 on WhatsApp.</p>
            <p>WhatsApp us at <b>+1 XXX XXX XXXX</b> (Twilio Sandbox)</p>
            <p><i>Summarize, draft, or explain legal content instantly.</i></p>
        </body>
    </html>
    """

# ================== WHATSAPP WEBHOOK ==================
@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    incoming_msg = request.values.get("Body", "").strip()
    sender = request.values.get("From", "")
    print(f"📩 {sender}: {incoming_msg}")

    twilio_resp = MessagingResponse()

    # If this is the first time we see this sender → greet them
    if sender not in user_state:
        user_state[sender] = {"stage": "new"}
        welcome_msg = (
            "👋 *Welcome to LegalSathi!*\n\n"
            "Your AI-powered Indian legal assistant, available 24/7.\n\n"
            "Type *hi* to start using LegalSathi."
        )
        twilio_resp.message(welcome_msg)
        return Response(str(twilio_resp), mimetype="application/xml")

    # === 1️⃣ Handle "hi" or "menu" messages ===
    if incoming_msg.lower() in ["hi", "hello", "hey", "menu", "start"]:
        menu = (
            "👋 *Welcome to LegalSathi!*\n\n"
            "Please choose what you’d like to do:\n"
            "1️⃣ Summarize a document\n"
            "2️⃣ Draft a legal contract\n"
            "3️⃣ Explain a legal clause\n\n"
            "_(Reply with 1, 2, or 3)_"
        )
        twilio_resp.message(menu)
        user_state[sender]["stage"] = "menu"
        return Response(str(twilio_resp), mimetype="application/xml")

    # === 2️⃣ If user is already in a task stage ===
    if sender in user_state and user_state[sender]["stage"] in ["summarize", "contract", "explain"]:
        stage = user_state[sender]["stage"]

        if stage == "summarize":
            ai_reply = ask_ai("Summarize this legal document in simple terms:", incoming_msg)
        elif stage == "contract":
            ai_reply = ask_ai("Create a detailed Indian legal contract for this case:", incoming_msg)
        elif stage == "explain":
            ai_reply = ask_ai("Explain this legal clause in plain Indian legal language:", incoming_msg)

        # Save PDF
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 PDF saved at: {pdf_path}")

        if len(ai_reply) > 1500:
            ai_reply = ai_reply[:1500] + "\n\n📎 Full document saved. Type 'pdf' to get the file."

        twilio_resp.message(ai_reply)
        user_state[sender]["stage"] = "done"
        return Response(str(twilio_resp), mimetype="application/xml")

    # === 3️⃣ Handle menu selection (1, 2, 3) ===
    if sender in user_state and user_state[sender]["stage"] == "menu":
        if incoming_msg == "1":
            twilio_resp.message("📄 Please paste the legal document you want me to *summarize*.")
            user_state[sender]["stage"] = "summarize"
            return Response(str(twilio_resp), mimetype="application/xml")

        elif incoming_msg == "2":
            twilio_resp.message("✍️ Please describe the *contract or agreement* you want me to generate.")
            user_state[sender]["stage"] = "contract"
            return Response(str(twilio_resp), mimetype="application/xml")

        elif incoming_msg == "3":
            twilio_resp.message("📘 Please paste the *legal clause or document* you want me to explain.")
            user_state[sender]["stage"] = "explain"
            return Response(str(twilio_resp), mimetype="application/xml")

        else:
            twilio_resp.message("⚠️ Invalid choice. Please reply with 1, 2, or 3.")
            return Response(str(twilio_resp), mimetype="application/xml")

    # === 4️⃣ PDF retrieval ===
    if incoming_msg.lower() == "pdf":
        pdf_path = "generated_pdfs/LegalSathi_Document.pdf"
        if os.path.exists(pdf_path):
            return send_file(pdf_path, as_attachment=True)
        else:
            twilio_resp.message("⚠️ No recent document found. Please generate a summary or contract first.")
            return Response(str(twilio_resp), mimetype="application/xml")

    # === 5️⃣ Default fallback ===
    twilio_resp.message(
        "👋 Welcome to LegalSathi!\n\nType *hi* to start using the service."
    )
    return Response(str(twilio_resp), mimetype="application/xml")

# ================== RUN FLASK SERVER ==================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi WhatsApp Bot is running on 0.0.0.0:{port}/whatsapp")
    app.run(host="0.0.0.0", port=port)

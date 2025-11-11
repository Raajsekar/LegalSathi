from flask import Flask, request, Response, send_file
from twilio.twiml.messaging_response import MessagingResponse
from groq import Groq
import os, time
from dotenv import load_dotenv
from pdf_utils import text_to_pdf

# ================== ENV & CLIENT SETUP ==================
load_dotenv()
app = Flask(__name__)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Store user conversation states
user_state = {}

# ================== AI HELPER FUNCTION ==================
def ask_ai(context, prompt):
    """Send prompt to Groq and return AI-generated text"""
    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are LegalSathi, an Indian AI legal assistant. "
                        "Be clear, professional, and accurate in Indian legal context."
                    ),
                },
                {"role": "user", "content": f"{context}\n{prompt}"},
            ],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("Groq Error:", e)
        return "⚠️ Sorry, I couldn’t process that right now. Please try again later."


# ================== HOMEPAGE (FOR RENDER WEBSITE) ==================
@app.route("/")
def home():
    return """
    <html>
        <head><title>⚖️ LegalSathi - AI Legal Assistant</title></head>
        <body style="font-family: Arial; text-align: center; margin-top: 100px;">
            <h1>⚖️ LegalSathi</h1>
            <p>Your 24/7 AI-powered Indian legal assistant.</p>
            <p>Now available on WhatsApp & web!</p>
            <p><b>Use it to:</b></p>
            <ul style="list-style:none;">
                <li>📄 Summarize legal documents</li>
                <li>✍️ Draft contracts & agreements</li>
                <li>📘 Explain legal clauses</li>
            </ul>
            <p><b>WhatsApp:</b> +1 (Twilio Sandbox Number)</p>
            <p><i>Powered by Groq AI + Twilio</i></p>
        </body>
    </html>
    """


# ================== MAIN CHATBOT LOGIC ==================
@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    incoming_msg = request.values.get("Body", "").strip()
    sender = request.values.get("From", "")
    print(f"📩 {sender}: {incoming_msg}")

    twilio_resp = MessagingResponse()

    # 🟢 GREET FIRST-TIME USERS
    if sender not in user_state:
        user_state[sender] = {"stage": "active"}
        welcome = (
            "👋 *Welcome to LegalSathi!*\n\n"
            "I'm your AI legal assistant 🤖⚖️\n\n"
            "You can ask me to:\n"
            "• Summarize a legal document\n"
            "• Draft a contract or agreement\n"
            "• Explain a legal clause\n\n"
            "Just type naturally, like:\n"
            "_‘Summarize this document...’_ or _‘Draft rent agreement between Raj and Kumar’_"
        )
        twilio_resp.message(welcome)
        return Response(str(twilio_resp), mimetype="application/xml")

    # 🧠 DETECT INTENT
    msg_lower = incoming_msg.lower()
    intent = None
    if any(word in msg_lower for word in ["summarize", "summary", "scribd.com"]):
        intent = "summarize"
    elif any(word in msg_lower for word in ["contract", "agreement", "draft"]):
        intent = "contract"
    elif any(word in msg_lower for word in ["explain", "meaning", "interpret", "clarify"]):
        intent = "explain"
    elif msg_lower in ["hi", "hello", "menu", "start", "restart"]:
        intent = "menu"
    elif msg_lower == "pdf":
        intent = "pdf"
    else:
        intent = "general"

    # ⚖️ HANDLE MENU
    if intent == "menu":
        menu = (
            "⚖️ *What would you like to do next?*\n\n"
            "1️⃣ Summarize a legal document\n"
            "2️⃣ Draft a contract or agreement\n"
            "3️⃣ Explain a legal clause\n\n"
            "Type what you want, like:\n"
            "_‘Draft NDA between A and B’_ or _‘Summarize my lease agreement’_"
        )
        twilio_resp.message(menu)
        return Response(str(twilio_resp), mimetype="application/xml")

    # 📘 HANDLE TASKS
    if intent in ["summarize", "contract", "explain", "general"]:
        if intent == "summarize":
            context = "Summarize this legal document clearly in simple Indian English:"
        elif intent == "contract":
            context = "Draft a professional Indian legal contract based on this request:"
        elif intent == "explain":
            context = "Explain this legal text in simple Indian legal language:"
        else:
            context = "Provide helpful legal advice or insights in Indian context:"

        ai_reply = ask_ai(context, incoming_msg)

        # SAVE PDF
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 PDF saved at: {pdf_path}")

        # SPLIT MESSAGE FOR WHATSAPP
        max_len = 1500
        msg_parts = [ai_reply[i:i+max_len] for i in range(0, len(ai_reply), max_len)]
        for part in msg_parts:
            twilio_resp.message(part)
        twilio_resp.message("📎 Type *pdf* to get the full document.\n⚖️ Type *menu* for more options.")
        return Response(str(twilio_resp), mimetype="application/xml")

    # 📄 HANDLE PDF REQUEST
    if intent == "pdf":
        pdf_files = [f for f in os.listdir("generated_pdfs") if f.endswith(".pdf")]
        if pdf_files:
            latest_pdf = max(pdf_files, key=lambda f: os.path.getctime(os.path.join("generated_pdfs", f)))
            return send_file(f"generated_pdfs/{latest_pdf}", as_attachment=True)
        else:
            twilio_resp.message("⚠️ No document found. Please generate one first.")
            return Response(str(twilio_resp), mimetype="application/xml")

    # 🔁 DEFAULT FALLBACK
    fallback = (
        "🤖 I can help with:\n"
        "• Drafting contracts\n"
        "• Summarizing documents\n"
        "• Explaining clauses\n\n"
        "Type *menu* to start again ⚖️"
    )
    twilio_resp.message(fallback)
    return Response(str(twilio_resp), mimetype="application/xml")


# ================== RUN FLASK SERVER ==================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi WhatsApp Bot is running on 0.0.0.0:{port}/whatsapp")
    app.run(host="0.0.0.0", port=port)

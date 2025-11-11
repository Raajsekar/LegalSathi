# =====================================
# ✅ LegalSathi WhatsApp Bot — Final Version
# =====================================

from flask import Flask, request, Response, send_file
from twilio.twiml.messaging_response import MessagingResponse
from groq import Groq
import os, time
from dotenv import load_dotenv
from pdf_utils import text_to_pdf

load_dotenv()

app = Flask(__name__)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Store user chat stage in memory
user_state = {}

# =============== AI HELPER FUNCTION ===============
def ask_ai(context, prompt):
    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are LegalSathi, an Indian AI legal assistant. "
                        "Provide clear, lawful, and helpful responses in the Indian legal context."
                    ),
                },
                {"role": "user", "content": f"{context}\n{prompt}"},
            ],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("Groq Error:", e)
        return "⚠️ Sorry, I couldn’t process that right now. Please try again later."


# =============== MAIN WHATSAPP ROUTE ===============
# Global state memory
user_state = {}

@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    incoming_msg = request.values.get("Body", "").strip()
    sender = request.values.get("From", "")
    print(f"📩 {sender}: {incoming_msg}")

    twilio_resp = MessagingResponse()

    # 🟢 Detect first message — greet immediately
    if sender not in user_state:
        user_state[sender] = {"stage": "active"}
        welcome = (
            "👋 *Welcome to LegalSathi!*\n\n"
            "I'm your AI legal assistant 🤖⚖️\n"
            "You can ask me to:\n"
            "• Summarize a legal document\n"
            "• Draft a contract or agreement\n"
            "• Explain a legal clause or law\n\n"
            "Just type naturally, like:\n"
            "_‘Summarize this agreement...’_ or _‘Explain this clause...’_"
        )
        twilio_resp.message(welcome)
        return Response(str(twilio_resp), mimetype="application/xml")

    # 🧠 Detect intent from text
    msg_lower = incoming_msg.lower()
    intent = None
    if "summarize" in msg_lower or "summary" in msg_lower or "scribd.com" in msg_lower:
        intent = "summarize"
    elif "contract" in msg_lower or "agreement" in msg_lower or "draft" in msg_lower:
        intent = "contract"
    elif "explain" in msg_lower or "meaning" in msg_lower or "interpret" in msg_lower:
        intent = "explain"
    elif incoming_msg.lower() in ["hi", "hello", "menu", "start", "restart"]:
        intent = "menu"
    elif incoming_msg.lower() == "pdf":
        intent = "pdf"

    # 🔄 Menu intent
    if intent == "menu":
        menu = (
            "⚖️ *What would you like to do next?*\n"
            "1️⃣ Summarize a legal document\n"
            "2️⃣ Draft a contract\n"
            "3️⃣ Explain a clause\n\n"
            "You can just type something like:\n"
            "➡️ ‘Summarize this document’ or ‘Draft an NDA between A and B’"
        )
        twilio_resp.message(menu)
        return Response(str(twilio_resp), mimetype="application/xml")

    # 📄 Handle Summarize
    if intent == "summarize":
        ai_reply = ask_ai("Summarize this legal document clearly in simple Indian English:", incoming_msg)
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 Summary saved at {pdf_path}")
        twilio_resp.message(ai_reply[:1500] + "\n\n📎 Type *pdf* to get the full file.")
        twilio_resp.message("⚖️ Want to do more? Type *menu* to continue.")
        return Response(str(twilio_resp), mimetype="application/xml")

    # 🧾 Handle Contract Drafting
    if intent == "contract":
        ai_reply = ask_ai("Draft a professional Indian legal contract for this:", incoming_msg)
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 Contract saved at {pdf_path}")
        twilio_resp.message(ai_reply[:1500] + "\n\n📎 Type *pdf* to get the full contract.")
        twilio_resp.message("⚖️ Want to do more? Type *menu* to continue.")
        return Response(str(twilio_resp), mimetype="application/xml")

    # 📘 Handle Explain
    if intent == "explain":
        ai_reply = ask_ai("Explain this legal text in clear, simple Indian legal terms:", incoming_msg)
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 Explanation saved at {pdf_path}")
        twilio_resp.message(ai_reply[:1500] + "\n\n📎 Type *pdf* to get the full explanation.")
        twilio_resp.message("⚖️ Want to do more? Type *menu* to continue.")
        return Response(str(twilio_resp), mimetype="application/xml")

    # 📎 Handle PDF
    if intent == "pdf":
        pdf_files = [f for f in os.listdir("generated_pdfs") if f.endswith(".pdf")]
        if pdf_files:
            latest_pdf = max(pdf_files, key=lambda f: os.path.getctime(os.path.join("generated_pdfs", f)))
            return send_file(f"generated_pdfs/{latest_pdf}", as_attachment=True)
        else:
            twilio_resp.message("⚠️ No recent document found. Please generate one first.")
            return Response(str(twilio_resp), mimetype="application/xml")

    # 🟡 Default fallback — conversational
    fallback = (
        "🤖 I’m here to help with legal tasks.\n"
        "Try saying:\n"
        "• ‘Summarize this contract’\n"
        "• ‘Draft an NDA between A and B’\n"
        "• ‘Explain this legal clause’\n\n"
        "Or type *menu* to see all options."
    )
    twilio_resp.message(fallback)
    return Response(str(twilio_resp), mimetype="application/xml")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi WhatsApp Bot is running on 0.0.0.0:{port}/whatsapp")
    app.run(host="0.0.0.0", port=port)

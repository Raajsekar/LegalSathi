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
@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    incoming_msg = request.values.get("Body", "").strip()
    sender = request.values.get("From", "")
    print(f"📩 {sender}: {incoming_msg}")

    twilio_resp = MessagingResponse()

    # === 1️⃣ Auto Menu for First-Time Users ===
    if sender not in user_state:
        user_state[sender] = {"stage": "menu"}
        menu = (
            "👋 *Welcome to LegalSathi!*\n\n"
            "Please choose what you’d like to do:\n"
            "1️⃣ Summarize a legal document\n"
            "2️⃣ Draft a legal contract\n"
            "3️⃣ Explain a legal clause\n\n"
            "_(Reply with 1, 2, or 3)_"
        )
        twilio_resp.message(menu)
        return Response(str(twilio_resp), mimetype="application/xml")

    # === 2️⃣ Reset menu when user types "hi" or "menu" ===
    if incoming_msg.lower() in ["hi", "hello", "menu", "start", "restart"]:
        user_state[sender]["stage"] = "menu"
        menu = (
            "⚖️ *Welcome back to LegalSathi!*\n\n"
            "1️⃣ Summarize a legal document\n"
            "2️⃣ Draft a legal contract\n"
            "3️⃣ Explain a legal clause\n\n"
            "_(Reply with 1, 2, or 3)_"
        )
        twilio_resp.message(menu)
        return Response(str(twilio_resp), mimetype="application/xml")

    # === 3️⃣ Handle Menu Selection ===
    if user_state[sender]["stage"] == "menu":
        if incoming_msg == "1":
            user_state[sender]["stage"] = "summarize"
            twilio_resp.message("📄 Please paste the *legal document* you want summarized.")
            return Response(str(twilio_resp), mimetype="application/xml")
        elif incoming_msg == "2":
            user_state[sender]["stage"] = "contract"
            twilio_resp.message("✍️ Please describe the *contract or agreement* you want generated.")
            return Response(str(twilio_resp), mimetype="application/xml")
        elif incoming_msg == "3":
            user_state[sender]["stage"] = "explain"
            twilio_resp.message("📘 Please paste the *clause or legal text* you want explained.")
            return Response(str(twilio_resp), mimetype="application/xml")
        else:
            twilio_resp.message("⚠️ Invalid option. Please reply with 1, 2, or 3.")
            return Response(str(twilio_resp), mimetype="application/xml")

    # === 4️⃣ Handle Active Task (Summarize / Contract / Explain) ===
    stage = user_state[sender]["stage"]
    if stage in ["summarize", "contract", "explain"]:
        if stage == "summarize":
            ai_reply = ask_ai("Summarize this legal document in clear Indian English:", incoming_msg)
        elif stage == "contract":
            ai_reply = ask_ai("Draft a professional Indian legal contract for this request:", incoming_msg)
        elif stage == "explain":
            ai_reply = ask_ai("Explain this legal clause in simple Indian language:", incoming_msg)

        # Save as PDF
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 PDF saved at: {pdf_path}")

        # Split message if too long for WhatsApp
        if len(ai_reply) > 1500:
            ai_reply = ai_reply[:1500] + "\n\n📎 Full document saved. Type *pdf* to get the file."

        twilio_resp.message(ai_reply)

        # 🟢 Auto show main menu after every task
        user_state[sender]["stage"] = "menu"
        menu = (
            "\n⚖️ *What would you like to do next?*\n"
            "1️⃣ Summarize another document\n"
            "2️⃣ Draft another contract\n"
            "3️⃣ Explain a legal clause\n\n"
            "_(Reply with 1, 2, or 3)_"
        )
        twilio_resp.message(menu)

        return Response(str(twilio_resp), mimetype="application/xml")

    # === 5️⃣ Handle PDF Request ===
    if incoming_msg.lower() == "pdf":
        pdf_path = "generated_pdfs/LegalSathi_Document.pdf"
        if os.path.exists(pdf_path):
            return send_file(pdf_path, as_attachment=True)
        else:
            twilio_resp.message("⚠️ No document found. Please generate one first.")
            return Response(str(twilio_resp), mimetype="application/xml")

    # === 6️⃣ Default Fallback ===
    twilio_resp.message("👋 Type *menu* to see available options.")
    return Response(str(twilio_resp), mimetype="application/xml")

from flask import Flask, request, Response
from twilio.twiml.messaging_response import MessagingResponse
from groq import Groq
import os
from dotenv import load_dotenv
from pdf_utils import text_to_pdf
import time
# Load environment variables from .env
load_dotenv()

# Initialize Flask app
app = Flask(__name__)

# Initialize Groq client
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# ================== AI HELPER FUNCTION ==================
def ask_ai(context, prompt):
    """
    Sends a query to Groq's Llama model and returns AI-generated text.
    """
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


# ================== INTENT DETECTION ==================
def detect_intent(message):
    """
    Very simple keyword-based intent detector.
    You can expand it later with NLP or regex.
    """
    m = message.lower()
    if "contract" in m or "agreement" in m:
        return "contract"
    if "summarize" in m:
        return "summarize"
    if "explain" in m:
        return "explain"
    return "general"


# ================== SMART MESSAGE ROUTING ==================
def process_message(msg):
    """
    Detects message intent and routes to appropriate AI prompt.
    """
    msg_lower = msg.lower()

    if msg_lower.startswith("contract"):
        return ask_ai(f"Draft a legal contract: {msg}")
    elif msg_lower.startswith("summarize"):
        return ask_ai(f"Summarize this legal document in simple terms: {msg}")
    elif msg_lower.startswith("explain"):
        return ask_ai(f"Explain this legal clause in simple terms: {msg}")
    elif msg_lower.startswith("legal notice"):
        return ask_ai(f"Draft a professional legal notice based on this: {msg}")
    elif msg_lower.startswith("pdf:"):
        content = msg.split("pdf:", 1)[1].strip()
        file_path = text_to_pdf(content)
        return f"📄 PDF generated successfully: {file_path}"
    else:
        return ask_ai(msg)


# ================== WHATSAPP WEBHOOK ==================
@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    incoming_msg = request.values.get("Body", "").strip()
    sender = request.values.get("From", "")
    print(f"📩 {sender}: {incoming_msg}")

    # Check if user requested PDF
    if incoming_msg.lower() == "pdf":
        pdf_path = "generated_pdfs/LegalSathi_Document.pdf"
        if os.path.exists(pdf_path):
            return send_file(pdf_path, as_attachment=True)
        else:
            twilio_resp = MessagingResponse()
            twilio_resp.message("⚠️ No document found. Please generate a contract first.")
            return Response(str(twilio_resp), mimetype="application/xml")

    # 🔍 Detect intent
    intent = detect_intent(incoming_msg)

    # 🧠 Route message based on intent
    if intent == "contract":
        ai_reply = ask_ai("Create a detailed legal contract", incoming_msg)
    elif intent == "summarize":
        ai_reply = ask_ai("Summarize the following legal content", incoming_msg)
    elif intent == "explain":
        ai_reply = ask_ai("Explain this legal text in simple language", incoming_msg)
    else:
        ai_reply = ask_ai("Provide helpful Indian legal advice", incoming_msg)

    # 💾 Save AI reply as PDF
    filename = f"LegalSathi_{int(time.time())}.pdf"
    pdf_path = text_to_pdf(ai_reply, filename)
    print(f"📄 PDF saved at: {pdf_path}")

    # ✂️ Split message if too long for WhatsApp
    max_len = 1500
    if len(ai_reply) > max_len:
        ai_reply = ai_reply[:max_len] + "\n\n📎 Full document saved. Type 'pdf' to get the complete file."

    # 📤 Send reply via Twilio
    twilio_resp = MessagingResponse()
    twilio_resp.message(ai_reply)
    print("🤖 AI reply sent successfully.")
    return Response(str(twilio_resp), mimetype="application/xml")

# ================== RUN FLASK SERVER ==================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi WhatsApp Bot is running on 0.0.0.0:{port}/whatsapp")
    app.run(host="0.0.0.0", port=port)


from flask import Flask, request, Response, send_file
from twilio.twiml.messaging_response import MessagingResponse
from groq import Groq
import os, time
from dotenv import load_dotenv
from pdf_utils import text_to_pdf

# ================== SETUP ==================
load_dotenv()
app = Flask(__name__)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
user_state = {}

# ================== AI HELPER FUNCTION ==================
def ask_ai(context, prompt):
    """Send prompt to Groq API and return AI-generated text."""
    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are LegalSathi, an Indian AI legal assistant. "
                        "Be professional, lawful, and clear in Indian legal context."
                    ),
                },
                {"role": "user", "content": f"{context}\n{prompt}"},
            ],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print("Groq Error:", e)
        return "⚠️ Sorry, I couldn’t process that right now. Please try again later."


# ================== WEB HOMEPAGE ==================
@app.route("/")
def home():
    return """
    <html>
        <head><title>⚖️ LegalSathi - Indian Legal AI</title></head>
        <body style='font-family:Arial;text-align:center;margin-top:100px'>
            <h1>⚖️ LegalSathi</h1>
            <p>Your AI-powered Indian legal assistant, available 24/7 on WhatsApp.</p>
            <p>Use LegalSathi to:</p>
            <ul style='list-style:none;'>
                <li>📄 Summarize legal documents</li>
                <li>✍️ Draft contracts and agreements</li>
                <li>📘 Explain legal clauses</li>
            </ul>
            <p><b>WhatsApp:</b> +1 (Twilio Sandbox Number)</p>
            <p><i>Powered by Groq AI + Twilio</i></p>
        </body>
    </html>
    """


# ================== MAIN CHAT LOGIC ==================
@app.route("/whatsapp", methods=["POST"])
def whatsapp_reply():
    incoming_msg = (request.values.get("Body") or "").strip()
    sender = request.values.get("From", "")
    print(f"📩 Message from {sender}: {incoming_msg}")

    resp = MessagingResponse()

    # 🟢 AUTO-MENU: Show greeting and menu *even if user sends nothing*
    if sender not in user_state or incoming_msg == "":
        user_state[sender] = {"stage": "menu"}
        greeting = (
            "👋 *Welcome to LegalSathi!*\n\n"
            "I can help you with:\n"
            "1️⃣ Summarizing a legal document\n"
            "2️⃣ Drafting a contract or agreement\n"
            "3️⃣ Explaining a legal clause\n\n"
            "_Reply with 1, 2, or 3 to continue._"
        )
        resp.message(greeting)
        return Response(str(resp), mimetype="application/xml")

    # 🧭 MENU SELECTION
    stage = user_state[sender]["stage"]

    if stage == "menu":
        if incoming_msg in ["1", "summarize", "summary"]:
            user_state[sender]["stage"] = "summarize"
            resp.message("📄 Please paste the *legal document text or link* to summarize.")
            return Response(str(resp), mimetype="application/xml")

        elif incoming_msg in ["2", "contract", "agreement"]:
            user_state[sender]["stage"] = "contract"
            resp.message("✍️ Please describe the *contract or agreement* you'd like drafted.")
            return Response(str(resp), mimetype="application/xml")

        elif incoming_msg in ["3", "explain", "clause"]:
            user_state[sender]["stage"] = "explain"
            resp.message("📘 Please paste the *legal clause or paragraph* you want explained.")
            return Response(str(resp), mimetype="application/xml")

        elif incoming_msg.lower() in ["hi", "hello", "menu", "start", "restart"]:
            resp.message(
                "⚖️ *Main Menu:*\n1️⃣ Summarize a document\n2️⃣ Draft a contract\n3️⃣ Explain a clause\n\n_Reply with 1, 2, or 3._"
            )
            return Response(str(resp), mimetype="application/xml")

        else:
            resp.message("⚠️ Invalid choice. Reply with 1, 2, or 3.")
            return Response(str(resp), mimetype="application/xml")

    # 🧠 EXECUTE TASKS
    if stage in ["summarize", "contract", "explain"]:
        if stage == "summarize":
            context = "Summarize this legal document clearly in Indian English:"
        elif stage == "contract":
            context = "Draft a legally valid Indian contract or agreement based on this request:"
        elif stage == "explain":
            context = "Explain this legal clause in simple Indian legal terms:"

        ai_reply = ask_ai(context, incoming_msg)

        # Save PDF
        filename = f"LegalSathi_{int(time.time())}.pdf"
        pdf_path = text_to_pdf(ai_reply, filename)
        print(f"📄 PDF saved to {pdf_path}")

        # Split long messages
        max_len = 1500
        for chunk in [ai_reply[i:i+max_len] for i in range(0, len(ai_reply), max_len)]:
            resp.message(chunk)

        resp.message("📎 Type *pdf* to get the document.\n⚖️ Type *menu* to return to main menu.")
        user_state[sender]["stage"] = "menu"
        return Response(str(resp), mimetype="application/xml")

    # 📂 PDF REQUEST
    if incoming_msg.lower() == "pdf":
        pdf_files = [f for f in os.listdir("generated_pdfs") if f.endswith(".pdf")]
        if pdf_files:
            latest = max(pdf_files, key=lambda f: os.path.getctime(os.path.join("generated_pdfs", f)))
            return send_file(f"generated_pdfs/{latest}", as_attachment=True)
        else:
            resp.message("⚠️ No document found. Please generate one first.")
            return Response(str(resp), mimetype="application/xml")

    # 🔁 DEFAULT FALLBACK
    resp.message("🤖 Type *menu* to see available options again.")
    return Response(str(resp), mimetype="application/xml")


# ================== RUN FLASK SERVER ==================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    print(f"🚀 LegalSathi Bot running on http://0.0.0.0:{port}/whatsapp")
    app.run(host="0.0.0.0", port=port)

from groq import Groq
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Groq client
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

def ask_ai(user_input, mode="general"):
    """
    Ask Groq's LLaMA model for a reply based on mode.
    Modes: 'general', 'legal_draft', 'summary', 'advice'
    """

    if mode == "summary":
        prompt = f"Summarize this legal document for a layperson in India:\n\n{user_input}"
    elif mode == "legal_draft":
        prompt = f"Draft a formal legal document in Indian context based on the following details:\n\n{user_input}"
    elif mode == "advice":
        prompt = f"Provide simple, non-binding legal advice in Indian context for this situation:\n\n{user_input}"
    else:
        prompt = f"You are LegalSathi, an AI legal assistant for Indian users. Answer clearly and factually:\n\n{user_input}"

    completion = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
    )

    reply = completion.choices[0].message.content
    return reply.strip()


def generate_contract(contract_type, details):
    """
    Generate an Indian-style legal contract using AI.
    """
    prompt = f"Generate a {contract_type} contract in professional Indian legal language. Include these details: {details}"
    completion = client.chat.completions.create(
        model="llama-3.1-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
    )
    reply = completion.choices[0].message.content
    return reply.strip()

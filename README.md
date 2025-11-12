# LegalSathi — AI Legal Assistant (Phase 1)

This repo contains a production-ready Phase 1 for LegalSathi:
- Backend: Flask + Groq + MongoDB (deployed to Render)
- Frontend: React + Tailwind + Firebase Auth (deployed to Vercel)
- Features: Chat-based AI, file upload (PDF/DOCX/TXT), PDF generation, chat history.

> **Important**: Do NOT commit secrets. Put keys in Render / Vercel environment variables.

## Quick Start (local)

### Backend
```bash
cd backend
python -m venv venv
# Windows:
# .\venv\Scripts\Activate.ps1
# mac/linux:
# source venv/bin/activate
pip install -r requirements.txt
# create backend/.env with GROQ_API_KEY and MONGODB_URI
python app.py

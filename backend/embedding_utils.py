# backend/embedding_utils.py
"""
Groq-only embedding utilities for LegalSathi.

- No torch / no faiss / no sentence-transformers.
- Uses Groq embeddings API, stores normalized embeddings in MongoDB.
- Retrieval computes cosine similarity in pure Python.

Functions:
  - index_document(db, conv_id, file_record_id, filename, text, user_id, index_name="global")
  - retrieve(db, query, top_k=6, index_name="global")
  - delete_index_for_file(db, file_record_id, index_name="global")
  - reindex_all_files(db, index_name="global")
"""

import os
import math
import uuid
import time
from typing import List

# Groq client
try:
    from groq import Groq
except Exception:
    Groq = None

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "") or os.getenv("GROQ_API_KEY", "")
if Groq is not None and GROQ_API_KEY:
    groq_client = Groq(api_key=GROQ_API_KEY)
else:
    groq_client = None

# -----------------------
# Text chunker
# -----------------------
def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
    if not text:
        return []
    text = text.replace("\r\n", "\n")
    chunks = []
    start = 0
    length = len(text)
    while start < length:
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk.strip())
        start = end - overlap
        if start < 0:
            start = 0
    return [c for c in chunks if c]

# -----------------------
# Vector helpers (pure python)
# -----------------------
def l2_norm(vec: List[float]) -> float:
    s = 0.0
    for v in vec:
        s += v * v
    return math.sqrt(s) if s > 0 else 1.0

def normalize(vec: List[float]) -> List[float]:
    norm = l2_norm(vec)
    if norm == 0:
        return vec
    return [v / norm for v in vec]

def dot(a: List[float], b: List[float]) -> float:
    total = 0.0
    ln = min(len(a), len(b))
    for i in range(ln):
        total += a[i] * b[i]
    return total

# -----------------------
# Groq embedding call (adapt if your SDK is different)
# -----------------------
def embed_text_groq(text: str) -> List[float]:
    if groq_client is None:
        raise RuntimeError("Groq client not configured.")

    try:
        res = groq_client.embeddings.create(
            model="nomic-embed-text",
            input=text
        )
        emb = res.data[0].embedding
        return list(emb)

    except Exception as e:
        raise RuntimeError(f"Groq embedding error: {e}")

# -----------------------
# Indexing and retrieval
# -----------------------
def index_document(db, conv_id, file_record_id, filename, text, user_id, index_name="global", chunk_size=1000, overlap=200):
    chunks = chunk_text(text, chunk_size=chunk_size, overlap=overlap)
    if not chunks:
        return {"status": "empty", "count": 0}

    coll = db.get_collection("embeddings")
    inserted = 0
    for i, c in enumerate(chunks):
        try:
            emb = embed_text_groq(c)
            emb_norm = normalize(emb)
        except Exception as e:
            print("embed_text_groq error:", e)
            continue

        doc = {
            "_id": str(uuid.uuid4()),
            "index": index_name,
            "conv_id": conv_id,
            "file_record_id": file_record_id,
            "filename": filename,
            "user_id": user_id,
            "chunk_text": c,
            "chunk_index": i,
            "embedding": emb_norm,
            "created_at": time.time()
        }

        try:
            coll.insert_one(doc)
            inserted += 1
        except Exception as e:
            print("Failed to insert embedding doc:", e)

    return {"status": "ok", "count": inserted}

def retrieve(db, query: str, top_k: int = 6, index_name: str = "global"):
    if not query or not query.strip():
        return []

    coll = db.get_collection("embeddings")
    try:
        q_emb = embed_text_groq(query)
        q_emb_norm = normalize(q_emb)
    except Exception as e:
        print("retrieve embed error:", e)
        return []

    try:
        cursor = coll.find({"index": index_name}).sort("created_at", -1).limit(2000)
        candidates = list(cursor)
    except Exception as e:
        print("DB fetch error in retrieve:", e)
        candidates = []

    hits = []
    for c in candidates:
        emb = c.get("embedding")
        if not emb:
            continue
        try:
            score = dot(q_emb_norm, emb)
        except Exception:
            score = dot(q_emb_norm, emb)
        hits.append((score, c))

    hits.sort(key=lambda x: x[0], reverse=True)

    out = []
    for score, c in hits[:top_k]:
        out.append({
            "score": float(score),
            "chunk_text": c.get("chunk_text", ""),
            "filename": c.get("filename"),
            "file_record_id": str(c.get("file_record_id", "")),
            "conv_id": str(c.get("conv_id", "")),
            "chunk_index": c.get("chunk_index", 0),
        })

    return out

def delete_index_for_file(db, file_record_id, index_name="global"):
    coll = db.get_collection("embeddings")
    try:
        res = coll.delete_many({"file_record_id": file_record_id, "index": index_name})
        return {"deleted_count": res.deleted_count}
    except Exception as e:
        print("delete_index_for_file error:", e)
        return {"error": str(e)}

def reindex_all_files(db, index_name="global"):
    try:
        files = list(db.get_collection("file_records").find({}))
    except Exception as e:
        print("reindex_all_files fetch error:", e)
        return {"status": "failed", "error": str(e)}

    results = {"indexed": 0, "skipped": 0, "errors": 0}
    for f in files:
        path = f.get("stored_path")
        if not path:
            results["skipped"] += 1
            continue
        try:
            content = ""
            if path.lower().endswith(".pdf"):
                try:
                    import fitz
                    with fitz.open(path) as pdf:
                        content = "\n".join([p.get_text("text") for p in pdf])
                except Exception as e:
                    print("pdf extract error:", e)
                    results["errors"] += 1
                    continue
            elif path.lower().endswith(".docx"):
                try:
                    import docx
                    doc = docx.Document(path)
                    content = "\n".join([p.text for p in doc.paragraphs])
                except Exception as e:
                    print("docx extract error:", e)
                    results["errors"] += 1
                    continue
            else:
                try:
                    with open(path, "r", encoding="utf8", errors="ignore") as fh:
                        content = fh.read()
                except Exception as e:
                    print("text file read error:", e)
                    results["errors"] += 1
                    continue

            idx_res = index_document(
                db=db,
                conv_id=str(f.get("conv_id")),
                file_record_id=str(f.get("_id")),
                filename=f.get("original_name"),
                text=content,
                user_id=f.get("user_id"),
                index_name=index_name
            )
            results["indexed"] += idx_res.get("count", 0) if isinstance(idx_res, dict) else 0
        except Exception as e:
            print("reindex_all_files error for file:", f.get("_id"), e)
            results["errors"] += 1

    return results

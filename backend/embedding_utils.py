# embedding_utils.py
"""
Groq-only embedding utilities for LegalSathi.

Features:
- Chunk plain text into overlapping chunks.
- Generate embeddings via Groq (requires GROQ_API_KEY env var).
- Store chunk metadata and normalized embeddings in MongoDB collection "embeddings".
- Retrieve top-k relevant chunks by computing cosine similarity in Python (no faiss/torch).
- Lightweight: no numpy, no sentence-transformers, no faiss.

Usage:
- index_document(db, conv_id, file_record_id, filename, text, user_id, index_name="global")
- retrieve(db, query, top_k=6, index_name="global")
- reindex_all_files(db, index_name="global")  # optional helper
"""

import os
import math
import uuid
import time
from typing import List, Dict

# Groq client (lightweight)
try:
    from groq import Groq
except Exception:
    Groq = None

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "") or os.getenv("GROQ_API_KEY", "")
if Groq is not None and GROQ_API_KEY:
    groq_client = Groq(api_key=GROQ_API_KEY)
else:
    groq_client = None

# Simple text chunker
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

# Normalization helpers (pure python)
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

# Groq embedding call
def embed_text_groq(text: str) -> List[float]:
    """
    Returns embedding (list of floats) for given text using Groq.
    Raises RuntimeError if groq_client is not configured.
    """
    if groq_client is None:
        raise RuntimeError("Groq client not configured. Set GROQ_API_KEY and install groq package.")

    # Use a compact prompt for embedding if API requires it; the Groq python SDK typically
    # exposes an embeddings API. If your Groq SDK has a different method, adapt here.
    # We'll try common shapes: client.embeddings.create or client.embeddings.embed
    try:
        # Try common API shape
        if hasattr(groq_client, "embeddings") and hasattr(groq_client.embeddings, "create"):
            res = groq_client.embeddings.create(model="embed-english-v1", input=text)
            emb = res.data[0].embedding if hasattr(res.data[0], "embedding") else res.data[0]
            return list(emb)
        elif hasattr(groq_client, "embeddings") and hasattr(groq_client.embeddings, "embed"):
            res = groq_client.embeddings.embed(model="embed-english-v1", input=text)
            return list(res)
        elif hasattr(groq_client, "embed"):
            # fallback
            return list(groq_client.embed(text))
        else:
            # generic chat completions fallback (unlikely)
            raise RuntimeError("Groq client doesn't expose recognized embeddings API. Check SDK version.")
    except Exception as e:
        # bubble up with context
        raise RuntimeError(f"Groq embedding error: {e}")

# Index a single document text into DB (chunks + embeddings)
def index_document(db, conv_id, file_record_id, filename, text, user_id, index_name="global", chunk_size=1000, overlap=200):
    """
    Splits text into chunks, computes embeddings with Groq, stores into 'embeddings' collection.
    Each document stored:
      {
        "_id": "<uuid>",
        "index": index_name,
        "conv_id": ObjectId or string,
        "file_record_id": ObjectId or string,
        "filename": filename,
        "user_id": user_id,
        "chunk_text": "...",
        "chunk_index": 0,
        "embedding": [...],      # normalized embedding list
        "created_at": timestamp
      }
    """
    # chunk
    chunks = chunk_text(text, chunk_size=chunk_size, overlap=overlap)
    if not chunks:
        return {"status": "empty", "count": 0}

    coll = db.get_collection("embeddings")

    inserted = 0
    for i, c in enumerate(chunks):
        # generate embedding
        try:
            emb = embed_text_groq(c)
            emb_norm = normalize(emb)
        except Exception as e:
            # if embedding fails, skip this chunk but log
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

# Retrieve top-k relevant chunks for query
def retrieve(db, query: str, top_k: int = 6, index_name: str = "global"):
    """
    1) Embed the query with Groq
    2) Fetch candidate chunks from DB (same index_name)
    3) Compute cosine similarity (dot of normalized vectors)
    4) Return top_k hits sorted by score

    WARNING: This implementation fetches all rows for the index and computes similarity in Python.
    If your embeddings collection grows very large, add pre-filtering (by user_id, conv_id, or use MongoDB Atlas Vector Search).
    """
    if not query or not query.strip():
        return []

    coll = db.get_collection("embeddings")

    # compute query embedding
    try:
        q_emb = embed_text_groq(query)
        q_emb_norm = normalize(q_emb)
    except Exception as e:
        print("retrieve embed error:", e)
        return []

    # fetch candidates - a simple strategy: recent N per index
    try:
        # fetch reasonable limit (e.g., 2000 most recent). Adjust as needed.
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
            score = dot(q_emb_norm, emb)  # dot of normalized vectors = cosine similarity
        except Exception:
            # mismatched length - compute min-length dot
            score = dot(q_emb_norm, emb)
        hits.append((score, c))

    # sort descending by score
    hits.sort(key=lambda x: x[0], reverse=True)

    # return top_k mapped to user-friendly dicts
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

# Optional: remove index entries for a file or reindex
def delete_index_for_file(db, file_record_id, index_name="global"):
    coll = db.get_collection("embeddings")
    try:
        res = coll.delete_many({"file_record_id": file_record_id, "index": index_name})
        return {"deleted_count": res.deleted_count}
    except Exception as e:
        print("delete_index_for_file error:", e)
        return {"error": str(e)}

def reindex_all_files(db, index_name="global"):
    """
    Helper utility to reindex all file_records collection entries.
    This expects 'file_records' collection to have:
      { "_id": ObjectId, "stored_path": "/path/to/file", "original_name": "...", "conv_id": ObjectId, "user_id": "..." }
    Use with caution on large datasets (rate-limit).
    """
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
            # read file - plain text or pdf/docx extraction not included here
            # For best results, keep the same extractor you use in app.upload_file (extract_pdf_text/extract_docx_text)
            content = ""
            if path.lower().endswith(".pdf"):
                try:
                    # lazy import to avoid heavy deps at module import time
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

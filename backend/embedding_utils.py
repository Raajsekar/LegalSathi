# embedding_utils.py
import os
import time
import uuid
import json
import math
import faiss
import pickle
from typing import List, Dict
from sentence_transformers import SentenceTransformer
from pymongo import MongoClient
from bson.objectid import ObjectId

# Config
EMBED_MODEL_NAME = os.getenv("EMBED_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")
INDEX_DIR = "faiss_indexes"
os.makedirs(INDEX_DIR, exist_ok=True)

# Initialize model (lazy)
_model = None
_dim = None

def get_model():
    global _model, _dim
    if _model is None:
        _model = SentenceTransformer(EMBED_MODEL_NAME)
        _dim = _model.get_sentence_embedding_dimension()
    return _model, _dim

# --- FAISS index helper per-user (or global) ---
def _index_path(name):
    return os.path.join(INDEX_DIR, f"faiss_{name}.index")

def create_faiss_index(name="global"):
    _, dim = get_model()
    idx = faiss.IndexFlatIP(dim)  # use inner product on normalized vectors -> cosine
    faiss.normalize_L2  # we'll normalize vectors before add
    return idx

def save_index(index, name="global"):
    path = _index_path(name)
    faiss.write_index(index, path)

def load_index(name="global"):
    path = _index_path(name)
    if os.path.exists(path):
        return faiss.read_index(path)
    return create_faiss_index(name)

# --- chunking logic (simple window + overlap) ---
def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    # naive split by sentences/paragraphs then accumulate
    import re
    parts = re.split(r'\n{2,}|\r\n{2,}', text)
    chunks = []
    buf = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(buf) + len(p) + 1 <= chunk_size:
            buf = buf + "\n\n" + p if buf else p
        else:
            if buf:
                chunks.append(buf)
            # if paragraph itself larger than chunk_size, break it
            while len(p) > chunk_size:
                chunks.append(p[:chunk_size])
                p = p[chunk_size - overlap:]
            buf = p
    if buf:
        chunks.append(buf)
    return chunks

# --- embedding + index a list of chunks ---
def index_document(db, conv_id, file_record_id, filename, text, user_id, index_name="global"):
    """
    Splits text into chunks, creates embeddings, stores metadata in Mongo 'embeddings' collection,
    and adds vectors to FAISS index (persisted per index_name).
    Returns list of embedded chunk meta.
    """
    model, dim = get_model()
    chunks = chunk_text(text, chunk_size=1200, overlap=200)
    vecs = model.encode(chunks, show_progress_bar=False, convert_to_numpy=True, normalize_embeddings=True)

    # Load or create index
    index = load_index(index_name)
    # keep mapping id -> metadata in Mongo
    embeddings_col = db.get_collection("embeddings")

    # We will add embeddings one by one and assign incremental ids based on faiss state
    existing_count = index.ntotal
    ids = []
    metas = []
    for i, chunk in enumerate(chunks):
        vec = vecs[i].astype('float32')
        index.add(vec.reshape(1, -1))
        new_id = existing_count + i
        # store metadata
        meta = {
            "index_name": index_name,
            "faiss_id": new_id,
            "conv_id": conv_id,
            "file_record_id": file_record_id,
            "filename": filename,
            "chunk_text": chunk,
            "user_id": user_id,
            "timestamp": time.time()
        }
        embeddings_col.insert_one(meta)
        metas.append(meta)
        ids.append(new_id)

    # persist index
    save_index(index, index_name)
    return metas

# --- retrieve top-k chunks given a query ---
def retrieve(db, query, top_k=5, index_name="global"):
    model, _ = get_model()
    qvec = model.encode([query], convert_to_numpy=True, normalize_embeddings=True).astype('float32')
    index = load_index(index_name)
    if index.ntotal == 0:
        return []
    # search
    D, I = index.search(qvec, top_k)
    ids = I[0].tolist()
    # load metadata for these faiss_ids
    hits = []
    for fid in ids:
        if fid < 0:
            continue
        meta = db.get_collection("embeddings").find_one({"faiss_id": fid, "index_name": index_name})
        if not meta:
            continue
        hits.append({
            "score": float(D[0][ids.index(fid)]) if D.size else None,
            "faiss_id": fid,
            "chunk_text": meta.get("chunk_text"),
            "filename": meta.get("filename"),
            "conv_id": str(meta.get("conv_id")) if meta.get("conv_id") else None,
            "file_record_id": str(meta.get("file_record_id")) if meta.get("file_record_id") else None,
            "timestamp": meta.get("timestamp")
        })
    return hits

# --- admin reindex helper: reindex all files (if needed) ---
def reindex_all_files(db, index_name="global"):
    index = create_faiss_index(index_name)
    # clear embeddings col
    db.get_collection("embeddings").delete_many({"index_name": index_name})
    files = list(db.get_collection("file_records").find({}))
    for f in files:
        try:
            path = f.get("stored_path")
            if not path or not os.path.exists(path):
                continue
            # naive extraction: try pdf or docx or txt
            text = ""
            if path.lower().endswith(".pdf"):
                from pdf_utils import extract_pdf_text as ext_pdf
                text = ext_pdf(path)
            elif path.lower().endswith(".docx"):
                from app import extract_docx_text as ext_docx
                text = ext_docx(path)
            else:
                with open(path, "r", encoding="utf8", errors="ignore") as fh:
                    text = fh.read()
            # chunk + embed (re-use index_document logic but with temporary index injection)
            metas = index_document(db, f.get("conv_id"), f.get("_id"), f.get("original_name"), text, f.get("user_id"), index_name=index_name)
        except Exception as e:
            print("reindex error for file", f.get("_id"), e)
    save_index(index, index_name)
    return True

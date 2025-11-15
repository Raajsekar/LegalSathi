# embedding_utils.py
import os
import time
import uuid
import json
import math
import pickle
from typing import List, Dict, Optional

# Try to import faiss — user must install faiss-cpu or faiss-gpu
try:
    import faiss
except Exception as e:
    faiss = None
    print("Warning: faiss import failed. Install faiss-cpu (pip) to enable vector index. Error:", e)

# Try Groq client if present
GROQ_CLIENT = None
try:
    from groq import Groq
    GROQ_CLIENT = Groq(api_key=os.getenv("GROQ_API_KEY", ""))
    print("Groq client available for embeddings (if EMBED_WITH_GROQ env enabled).")
except Exception:
    GROQ_CLIENT = None

# Sentence-transformers fallback
_sentence_model = None
_dim = None
USE_SENTENCE_TRANSFORMERS = True
try:
    from sentence_transformers import SentenceTransformer
except Exception:
    SentenceTransformer = None
    USE_SENTENCE_TRANSFORMERS = False
    print("SentenceTransformer not available; install 'sentence-transformers' for local embedding fallback.")

# Configs / defaults
EMBED_MODEL_NAME = os.getenv("EMBED_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")
INDEX_DIR = os.getenv("FAISS_INDEX_DIR", "uploads/faiss")
os.makedirs(INDEX_DIR, exist_ok=True)

# Chunk sizes tuned for LONG documents
DEFAULT_CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", 2000))   # characters
DEFAULT_OVERLAP = int(os.getenv("CHUNK_OVERLAP", 300))

# choose whether to use Groq embeddings (env var)
EMBED_WITH_GROQ = os.getenv("EMBED_WITH_GROQ", "false").lower() in ("1", "true", "yes")

def get_sentence_model():
    global _sentence_model, _dim
    if _sentence_model is None:
        if SentenceTransformer is None:
            raise RuntimeError("sentence-transformers not installed")
        _sentence_model = SentenceTransformer(EMBED_MODEL_NAME)
        _dim = _sentence_model.get_sentence_embedding_dimension()
    return _sentence_model, _dim

def _index_path(name: str):
    return os.path.join(INDEX_DIR, f"faiss_{name}.index")

def create_faiss_index(name="global", dim=384):
    if faiss is None:
        raise RuntimeError("faiss not installed. pip install faiss-cpu")
    idx = faiss.IndexIDMap(faiss.IndexFlatIP(dim))  # store ids explicitly
    return idx

def save_index(index, name="global"):
    if faiss is None:
        raise RuntimeError("faiss not installed")
    path = _index_path(name)
    faiss.write_index(index, path)

def load_index(name="global", dim=384):
    path = _index_path(name)
    if faiss is None:
        raise RuntimeError("faiss not installed")
    if os.path.exists(path):
        try:
            idx = faiss.read_index(path)
            return idx
        except Exception as e:
            print("faiss read_index failed, creating new index:", e)
    # new index
    return create_faiss_index(name, dim=dim)

# --------- chunking ---------
import re
def chunk_text(text: str, chunk_size: int = DEFAULT_CHUNK_SIZE, overlap: int = DEFAULT_OVERLAP) -> List[str]:
    # naive paragraph + window approach
    parts = re.split(r'\n{2,}|\r\n{2,}', text)
    chunks = []
    buf = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(buf) + len(p) + 2 <= chunk_size:
            buf = buf + "\n\n" + p if buf else p
        else:
            if buf:
                chunks.append(buf)
            # break long paragraph
            temp = p
            while len(temp) > chunk_size:
                chunks.append(temp[:chunk_size])
                temp = temp[chunk_size - overlap:]
            buf = temp
    if buf:
        chunks.append(buf)
    return chunks

# --------- embeddings helpers ---------
def _embed_with_groq(texts: List[str]) -> List[List[float]]:
    """
    Try to use GROQ embeddings. API depends on Groq client library.
    We attempt best-effort: call client.embeddings.create if exists.
    If it fails fallback to sentence-transformers.
    """
    if GROQ_CLIENT is None:
        raise RuntimeError("Groq client not available")
    try:
        # Best-effort call (Groq SDKs differ). We attempt the common shape:
        resp = GROQ_CLIENT.embeddings.create(model=os.getenv("GROQ_EMBED_MODEL", "embed-1"), input=texts)
        # resp shape might differ — try to extract embeddings
        if hasattr(resp, "data"):
            emb = [item.embedding for item in resp.data]
            return emb
        # fallback if dict
        if isinstance(resp, dict) and "data" in resp:
            return [d.get("embedding") for d in resp["data"]]
        # last resort: assume resp is list of vectors
        return list(resp)
    except Exception as e:
        print("Groq embedding failed:", e)
        raise

def _embed_with_sentence_transformers(texts: List[str]):
    model, dim = get_sentence_model()
    vecs = model.encode(texts, show_progress_bar=False, convert_to_numpy=True, normalize_embeddings=True)
    return vecs.astype('float32'), dim

def embed_texts(texts: List[str]):
    """
    Return (vectors (numpy array or list), dim)
    """
    # If user explicitly requested Groq and client available, try that first
    if EMBED_WITH_GROQ and GROQ_CLIENT is not None:
        try:
            emb = _embed_with_groq(texts)
            # convert to numpy float32 array if possible
            import numpy as np
            arr = np.array(emb, dtype='float32')
            # normalize for cosine via inner product search
            norms = np.linalg.norm(arr, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            arr = arr / norms
            return arr, arr.shape[1]
        except Exception as e:
            print("Groq embeddings failed, falling back to sentence-transformers:", e)

    # fallback local
    if not USE_SENTENCE_TRANSFORMERS:
        raise RuntimeError("No embedding backend available (Groq disabled/unavailable and sentence-transformers not installed).")
    vecs, dim = _embed_with_sentence_transformers(texts)
    return vecs, dim

# --------- indexing & retrieval ---------
def index_document(db, conv_id, file_record_id, filename, text, user_id, index_name="global"):
    """
    Splits text into chunks, creates embeddings, stores metadata in Mongo 'embeddings' collection,
    and adds vectors to FAISS index (persisted per index_name).
    Returns list of embedded chunk meta.
    """
    import numpy as np
    chunks = chunk_text(text)
    if not chunks:
        return []

    vecs, dim = embed_texts(chunks)

    # load or create faiss index (IDMap)
    if faiss is None:
        raise RuntimeError("faiss is required for indexing. Install faiss-cpu.")
    index = load_index(index_name, dim=dim)

    # ensure index has correct dimension
    try:
        if index.is_trained:
            pass
    except Exception:
        # ignore

        pass

    embeddings_col = db.get_collection("embeddings")

    # assign unique ids (use Mongo ObjectId int mapping or incremental)
    # We'll use an integer id generated from time+uuid hash to avoid collisions
    metas = []
    add_vecs = []
    add_ids = []
    for chunk in chunks:
        # generate int id
        int_id = int(uuid.uuid4().int >> 64) & ((1 << 63) - 1)
        add_ids.append(int_id)
        add_vecs.append(vecs[len(add_ids)-1])

        meta = {
            "index_name": index_name,
            "faiss_id": int_id,
            "conv_id": conv_id if isinstance(conv_id, (str,)) else str(conv_id),
            "file_record_id": str(file_record_id),
            "filename": filename,
            "chunk_text": chunk,
            "user_id": user_id,
            "timestamp": time.time()
        }
        embeddings_col.insert_one(meta)
        metas.append(meta)

    # add vectors to index with ids
    arr = np.vstack(add_vecs).astype('float32')
    index.add_with_ids(arr, np.array(add_ids, dtype='int64'))
    save_index(index, index_name)
    return metas

def retrieve(db, query: str, top_k: int = 5, index_name: str = "global"):
    """
    Return top_k hits as list of dicts with keys:
      score, faiss_id, chunk_text, filename, conv_id, file_record_id, timestamp
    """
    import numpy as np
    if faiss is None:
        print("faiss not installed — retrieval disabled.")
        return []

    qvecs, dim = embed_texts([query])
    q = qvecs[0].astype('float32').reshape(1, -1)

    index = load_index(index_name, dim=dim)
    if index.ntotal == 0:
        return []

    D, I = index.search(q, top_k)
    D = D.tolist()
    I = I.tolist()
    hits = []
    for score, fid in zip(D[0], I[0]):
        if int(fid) < 0:
            continue
        meta = db.get_collection("embeddings").find_one({"faiss_id": int(fid), "index_name": index_name})
        if not meta:
            continue
        hits.append({
            "score": float(score),
            "faiss_id": int(fid),
            "chunk_text": meta.get("chunk_text"),
            "filename": meta.get("filename"),
            "conv_id": meta.get("conv_id"),
            "file_record_id": meta.get("file_record_id"),
            "timestamp": meta.get("timestamp")
        })
    return hits

def reindex_all_files(db, index_name="global"):
    """
    Recreate index from scratch using file_records collection.
    WARNING: This removes existing embeddings documents for the index_name.
    """
    if faiss is None:
        raise RuntimeError("faiss not installed")

    # clear embeddings collection entries for index
    db.get_collection("embeddings").delete_many({"index_name": index_name})
    # create fresh index with dimension guessed from model
    # create a temp model to get dim
    if EMBED_WITH_GROQ and GROQ_CLIENT is not None:
        # we don't know dim — create index with 1536 (common) and let faiss accept
        dim = int(os.getenv("FALLBACK_EMBED_DIM", 1536))
    else:
        model, dim = get_sentence_model()

    index = create_faiss_index(name=index_name, dim=dim)

    files = list(db.get_collection("file_records").find({}))
    for f in files:
        try:
            path = f.get("stored_path")
            if not path or not os.path.exists(path):
                continue
            # extract text
            text = ""
            if path.lower().endswith(".pdf"):
                # user should provide pdf extraction function externally
                from pdf_utils import extract_pdf_text as ext_pdf
                text = ext_pdf(path)
            elif path.lower().endswith(".docx"):
                from app import extract_docx_text as ext_docx
                text = ext_docx(path)
            else:
                with open(path, "r", encoding="utf8", errors="ignore") as fh:
                    text = fh.read()
            # chunk + embed + insert into index
            metas = index_document(db, f.get("conv_id"), f.get("_id"), f.get("original_name"), text, f.get("user_id"), index_name=index_name)
        except Exception as e:
            print("reindex error for file", f.get("_id"), e)
    # persisted inside index_document calls
    save_index(index, index_name)
    return True

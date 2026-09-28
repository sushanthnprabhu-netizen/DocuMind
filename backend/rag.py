"""
Real, local, API-key-free RAG pipeline.

Stages (mirroring the course assignments):
  1. Ingestion   -> extract_text()      (pdf / docx / xlsx / csv / txt / md)
  2. Chunking    -> chunk_text()        (RecursiveCharacterTextSplitter)
  3. Embedding   -> TfidfVectorizer     (scikit-learn, fully local, no model
                                          download, no API key)
  4. Vector DB   -> FAISS IndexFlatIP   (cosine similarity via normalized
                                          vectors, in-memory, rebuilt from
                                          the SQLite chunk table)
  5. Retrieval   -> UserIndex.search()
  6. "Generation"-> build_extractive_answer()
                    No LLM call (no API key available/wanted). The answer
                    is assembled directly from the retrieved chunks with
                    source attribution, so it is always grounded and can
                    never hallucinate -- the tradeoff is that it's
                    extractive, not fluently generated prose.
"""

from __future__ import annotations

import csv
import io
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import os
from dotenv import load_dotenv
import psycopg
from psycopg.rows import dict_row

import numpy as np
import faiss
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sklearn.feature_extraction.text import TfidfVectorizer

BASE_DIR = Path(__file__).resolve().parent

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not configured in backend/.env")

CHUNK_SIZE = 800
CHUNK_OVERLAP = 150
TOP_K = 4
MIN_SIMILARITY = 0.08  # below this, we treat retrieval as "no good match"

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    length_function=len,
    separators=["\n\n", "\n", " ", ""],
)


# --------------------------------------------------------------------------
# Stage 1: Ingestion — extract raw text from a variety of file types
# --------------------------------------------------------------------------

def extract_text(file_bytes: bytes, filename: str) -> str:
    """Best-effort text extraction. Returns '' for unsupported/binary types
    (the file is still stored and downloadable -- it just won't be
    searchable by the assistant)."""
    suffix = Path(filename).suffix.lower()

    try:
        if suffix in (".txt", ".md", ".json", ".log"):
            return file_bytes.decode("utf-8", errors="ignore")

        if suffix == ".csv":
            text_io = io.StringIO(file_bytes.decode("utf-8", errors="ignore"))
            rows = list(csv.reader(text_io))
            return "\n".join(", ".join(row) for row in rows)

        if suffix == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(file_bytes))
            pages = []
            for i, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    pages.append(f"[Page {i + 1}]\n{page_text}")
            return "\n\n".join(pages)

        if suffix == ".docx":
            import docx

            document = docx.Document(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in document.paragraphs if p.text.strip())

        if suffix == ".xlsx":
            import openpyxl

            workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            lines = []
            for sheet in workbook.worksheets:
                for row in sheet.iter_rows(values_only=True):
                    cells = [str(c) for c in row if c is not None]
                    if cells:
                        lines.append(", ".join(cells))
            return "\n".join(lines)

    except Exception:
        return ""

    return ""


# --------------------------------------------------------------------------
# Stage 2: Chunking
# --------------------------------------------------------------------------

def chunk_text(text: str) -> list[str]:
    if not text or not text.strip():
        return []
    return [c for c in _splitter.split_text(text) if c.strip()]


# --------------------------------------------------------------------------
# Stages 3-5: Embedding + FAISS vector store + retrieval, per user
# --------------------------------------------------------------------------

@dataclass
class ChunkRecord:
    chunk_id: int
    document_id: int
    filename: str
    chunk_index: int
    content: str


@dataclass
class UserIndex:
    vectorizer: Optional[TfidfVectorizer] = None
    faiss_index: Optional[faiss.Index] = None
    records: dict[int, ChunkRecord] = field(default_factory=dict)  # chunk_id -> record
    id_order: list[int] = field(default_factory=list)  # row order matches faiss ids

    def is_ready(self) -> bool:
        return self.faiss_index is not None and self.faiss_index.ntotal > 0

    def search(self, query: str, top_k: int = TOP_K) -> list[dict]:
        if not self.is_ready() or not query.strip():
            return []

        query_vec = self.vectorizer.transform([query]).toarray().astype("float32")
        norm = np.linalg.norm(query_vec, axis=1, keepdims=True)
        norm[norm == 0] = 1.0
        query_vec = query_vec / norm

        k = min(top_k, self.faiss_index.ntotal)
        scores, ids = self.faiss_index.search(query_vec, k)

        results = []
        for score, chunk_id in zip(scores[0], ids[0]):
            if chunk_id == -1:
                continue
            record = self.records.get(int(chunk_id))
            if not record:
                continue
            results.append(
                {
                    "chunk_id": record.chunk_id,
                    "document_id": record.document_id,
                    "filename": record.filename,
                    "chunk_index": record.chunk_index,
                    "content": record.content,
                    "similarity_score": float(score),
                }
            )
        return results


# In-memory cache: user_id -> UserIndex. Rebuilt from SQLite whenever a
# document is uploaded or deleted (see main.py), so SQLite stays the
# single source of truth and the index is always cheap to reconstruct.
_user_indexes: dict[int, UserIndex] = {}


def invalidate_user_index(user_id: int) -> None:
    _user_indexes.pop(user_id, None)


def build_user_index(user_id: int, chunk_rows: list[dict]) -> UserIndex:
    """chunk_rows: list of dicts with keys id, document_id, original_name,
    chunk_index, content (as stored in the document_chunks table)."""
    index = UserIndex()

    if not chunk_rows:
        _user_indexes[user_id] = index
        return index

    texts = [row["content"] for row in chunk_rows]
    # (rows use keys: id, document_id, filename, chunk_index, content)

    vectorizer = TfidfVectorizer(
        stop_words="english",
        max_features=20_000,
        ngram_range=(1, 2),
    )
    matrix = vectorizer.fit_transform(texts).toarray().astype("float32")

    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = matrix / norms

    dim = matrix.shape[1]
    flat_index = faiss.IndexFlatIP(dim)
    id_index = faiss.IndexIDMap(flat_index)

    ids = np.array([row["id"] for row in chunk_rows], dtype="int64")
    id_index.add_with_ids(matrix, ids)

    for row in chunk_rows:
        index.records[row["id"]] = ChunkRecord(
            chunk_id=row["id"],
            document_id=row["document_id"],
            filename=row["filename"],
            chunk_index=row["chunk_index"],
            content=row["content"],
        )

    index.vectorizer = vectorizer
    index.faiss_index = id_index
    index.id_order = list(ids)

    _user_indexes[user_id] = index
    return index


def get_or_build_user_index(user_id: int, chunk_loader) -> UserIndex:
    """chunk_loader: callable(user_id) -> list[dict] pulling fresh rows
    from SQLite. Only called on a cache miss."""
    if user_id in _user_indexes:
        return _user_indexes[user_id]
    return build_user_index(user_id, chunk_loader(user_id))


# --------------------------------------------------------------------------
# Stage 6: LLM generation using local ollama
# --------------------------------------------------------------------------

def build_llm_answer(question: str, matches: list[dict]) -> dict:
    """Generate a grounded answer using the locally running Ollama model."""

    if not matches or matches[0]["similarity_score"] < MIN_SIMILARITY:
        return {
            "answer": (
                "I couldn't find anything in your documents that matches that "
                "question closely enough. Try rephrasing your question."
            ),
            "sources": [],
            "generated": False,
        }

    good_matches = [
        m for m in matches
        if m["similarity_score"] >= MIN_SIMILARITY
    ]

    context_parts = []

    sources = []

    for match in good_matches:
        context_parts.append(
            f'SOURCE: {match["filename"]}\n'
            f'{match["content"].strip()}'
        )

        sources.append(
            {
                "filename": match["filename"],
                "chunk_index": match["chunk_index"],
                "similarity_score": round(match["similarity_score"], 3),
            }
        )

    context = "\n\n---\n\n".join(context_parts)

    prompt = f"""You are DocuMind, a document question-answering assistant.

Answer the user's question using ONLY the information contained in the
provided document context.

Rules:
- Do not use outside knowledge.
- Do not invent facts.
- If the context does not contain enough information, say so clearly.
- Give a direct, concise answer.
- When useful, organize the answer with short bullet points.
- Do not mention similarity scores, embeddings, FAISS, TF-IDF, or retrieval.
- Do not say "according to the context" repeatedly.
- Preserve important numbers, conditions, requirements, and terminology from
  the documents.

USER QUESTION:
{question}

DOCUMENT CONTEXT:
{context}

ANSWER:
"""

    try:
        import ollama

        response = ollama.chat(
            model="llama3.2:latest",
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
        )

        answer = response["message"]["content"].strip()

        if not answer:
            raise RuntimeError("Ollama returned an empty response")

        return {
            "answer": answer,
            "sources": sources,
            "generated": True,
        }

    except Exception as exc:
        return {
            "answer": (
                "The relevant document sections were found, but I couldn't "
                f"generate the AI response. Ollama error: {exc}"
            ),
            "sources": sources,
            "generated": False,
        }
# --------------------------------------------------------------------------
# Supabase persistence for document chunks
# --------------------------------------------------------------------------

@contextmanager
def _get_rag_db():
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _load_user_chunks(user_id: int) -> list[dict]:
    with _get_rag_db() as db:
        rows = db.execute(
            """
            SELECT id, document_id, filename, chunk_index, content
            FROM document_chunks
            WHERE user_id = %s
            ORDER BY id
            """,
            (user_id,),
        ).fetchall()
    return rows


# --------------------------------------------------------------------------
# Public API used by main.py
# --------------------------------------------------------------------------

def ingest_document(user_id: int, document_id: int, file_path: Path, filename: str) -> dict:
    """Extract -> chunk -> store for one freshly-uploaded file. Returns
    {'indexed': bool, 'chunk_count': int}. Safe to call for any file type;
    unsupported/binary files simply come back as not indexed."""
    file_bytes = Path(file_path).read_bytes()
    text = extract_text(file_bytes, filename)
    chunks = chunk_text(text)

    if not chunks:
        return {"indexed": False, "chunk_count": 0}

    with _get_rag_db() as db:
        db.executemany(
            """
            INSERT INTO document_chunks (user_id, document_id, filename, chunk_index, content)
            VALUES (%s, %s, %s, %s, %s)
            """,
            [
                (user_id, document_id, filename, idx, content)
                for idx, content in enumerate(chunks)
            ],
        )

    invalidate_user_index(user_id)
    return {"indexed": True, "chunk_count": len(chunks)}


def delete_document_chunks(document_id: int, user_id: int | None = None) -> None:
    """Delete chunk rows when needed and invalidate the user's FAISS cache."""
    with _get_rag_db() as db:
        if user_id is None:
            row = db.execute(
                "SELECT user_id FROM document_chunks WHERE document_id = %s LIMIT 1",
                (document_id,),
            ).fetchone()
            user_id = row["user_id"] if row else None
        db.execute("DELETE FROM document_chunks WHERE document_id = %s", (document_id,))

    if user_id is not None:
        invalidate_user_index(user_id)


def answer_question(question: str, user_id: int) -> dict:
    """Retrieve relevant chunks and generate a grounded answer with Ollama."""

    index = get_or_build_user_index(user_id, _load_user_chunks)
    matches = index.search(question, top_k=TOP_K)

    return build_llm_answer(question, matches)
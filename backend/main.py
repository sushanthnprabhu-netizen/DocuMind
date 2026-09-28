import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import rag

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "app.db"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="DocuMind Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                content_type TEXT,
                size_bytes INTEGER NOT NULL,
                uploaded_at TEXT NOT NULL,
                indexed INTEGER NOT NULL DEFAULT 0,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
            """
        )


init_db()


# --------------------------------------------------------------------------
# Password hashing (stdlib only, no external deps)
# --------------------------------------------------------------------------

def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return digest.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, password_hash)


# --------------------------------------------------------------------------
# Auth helpers
# --------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session(db, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user_id, now_iso()),
    )
    return token


def get_current_user(authorization: str | None) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()

    with get_db() as db:
        row = db.execute(
            """
            SELECT users.* FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return row


def user_public(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------

class RegisterPayload(BaseModel):
    email: str
    password: str
    name: str


class LoginPayload(BaseModel):
    email: str
    password: str


class AskPayload(BaseModel):
    question: str


# --------------------------------------------------------------------------
# Basic routes
# --------------------------------------------------------------------------

@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "DocuMind backend is running"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


# --------------------------------------------------------------------------
# Auth routes
# --------------------------------------------------------------------------

@app.post("/auth/register")
def register(payload: RegisterPayload):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")

    password_hash, salt = hash_password(payload.password)

    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="An account with this email already exists")

        cursor = db.execute(
            "INSERT INTO users (email, name, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)",
            (email, payload.name.strip(), password_hash, salt, now_iso()),
        )
        user_id = cursor.lastrowid
        token = create_session(db, user_id)
        user_row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    return {"token": token, "user": user_public(user_row)}


@app.post("/auth/login")
def login(payload: LoginPayload):
    email = payload.email.strip().lower()

    with get_db() as db:
        user_row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user_row or not verify_password(payload.password, user_row["password_hash"], user_row["salt"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        token = create_session(db, user_row["id"])

    return {"token": token, "user": user_public(user_row)}


@app.post("/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        with get_db() as db:
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"ok": True}


@app.get("/auth/me")
def me(authorization: str | None = Header(default=None)):
    user_row = get_current_user(authorization)
    return user_public(user_row)


# --------------------------------------------------------------------------
# Document routes
# --------------------------------------------------------------------------

def doc_public(row: sqlite3.Row) -> dict:
    size = row["size_bytes"]
    size_label = f"{size / (1024 * 1024):.1f} MB" if size >= 1024 * 1024 else f"{max(1, round(size / 1024))} KB"
    return {
        "id": row["id"],
        "name": row["original_name"],
        "type": (row["original_name"].rsplit(".", 1)[-1].upper() if "." in row["original_name"] else "FILE"),
        "size": size_label,
        "size_bytes": size,
        "uploaded_at": row["uploaded_at"],
        "indexed": bool(row["indexed"]),
        "chunk_count": row["chunk_count"],
    }


@app.get("/documents")
def list_documents(authorization: str | None = Header(default=None)):
    user_row = get_current_user(authorization)
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC",
            (user_row["id"],),
        ).fetchall()
    return {"documents": [doc_public(r) for r in rows]}


@app.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    user_row = get_current_user(authorization)

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (20 MB limit)")

    user_dir = UPLOAD_DIR / str(user_row["id"])
    user_dir.mkdir(parents=True, exist_ok=True)

    stored_name = f"{secrets.token_hex(8)}_{file.filename}"
    dest_path = user_dir / stored_name
    dest_path.write_bytes(contents)

    with get_db() as db:
        cursor = db.execute(
            """
            INSERT INTO documents (user_id, original_name, stored_name, content_type, size_bytes, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_row["id"], file.filename, stored_name, file.content_type, len(contents), now_iso()),
        )
        document_id = cursor.lastrowid

    # Run the RAG ingestion pipeline: extract -> chunk -> embed -> store in
    # the vector DB. Best-effort: unsupported formats (images, .xlsx, etc.)
    # simply aren't indexed for the assistant, but the upload itself still
    # succeeds.
    try:
        index_result = rag.ingest_document(user_row["id"], document_id, dest_path, file.filename)
    except Exception:
        index_result = {"indexed": False, "chunk_count": 0}

    with get_db() as db:
        db.execute(
            "UPDATE documents SET indexed = ?, chunk_count = ? WHERE id = ?",
            (1 if index_result["indexed"] else 0, index_result["chunk_count"], document_id),
        )
        doc_row = db.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()

    return doc_public(doc_row)


@app.get("/documents/{document_id}/download")
def download_document(document_id: int, authorization: str | None = Header(default=None)):
    user_row = get_current_user(authorization)

    with get_db() as db:
        doc_row = db.execute(
            "SELECT * FROM documents WHERE id = ? AND user_id = ?",
            (document_id, user_row["id"]),
        ).fetchone()

    if not doc_row:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = UPLOAD_DIR / str(user_row["id"]) / doc_row["stored_name"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File missing on server")

    return FileResponse(
        path=file_path,
        filename=doc_row["original_name"],
        media_type=doc_row["content_type"] or "application/octet-stream",
    )


@app.delete("/documents/{document_id}")
def delete_document(document_id: int, authorization: str | None = Header(default=None)):
    user_row = get_current_user(authorization)

    with get_db() as db:
        doc_row = db.execute(
            "SELECT * FROM documents WHERE id = ? AND user_id = ?",
            (document_id, user_row["id"]),
        ).fetchone()

        if not doc_row:
            raise HTTPException(status_code=404, detail="Document not found")

        file_path = UPLOAD_DIR / str(user_row["id"]) / doc_row["stored_name"]
        if file_path.exists():
            file_path.unlink()

        db.execute("DELETE FROM documents WHERE id = ?", (document_id,))

    rag.delete_document_chunks(document_id)

    return {"ok": True}


# --------------------------------------------------------------------------
# Assistant route — real RAG (retrieve from the vector store, then generate)
# with cheap direct answers for simple workspace-metadata questions.
# --------------------------------------------------------------------------

@app.post("/assistant/ask")
def ask_assistant(payload: AskPayload, authorization: str | None = Header(default=None)):
    user_row = get_current_user(authorization)
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    q = question.lower()

    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC",
            (user_row["id"],),
        ).fetchall()

    docs = [doc_public(r) for r in rows]

    if not docs:
        return {
            "data": {
                "answer": "You don't have any documents in your workspace yet. Upload one to get started.",
                "document_count": 0,
                "sources": [],
            }
        }

    # Simple workspace-metadata questions are answered directly (a vector
    # search isn't the right tool for "how many files do I have"). These
    # all require an explicit document/file/workspace reference so a real
    # content question that happens to contain "how many" or "list" (e.g.
    # "how many hours do cats sleep") correctly falls through to RAG below
    # instead of being misread as a metadata question.
    mentions_docs = any(word in q for word in ["document", "file", "workspace", "upload"])

    if mentions_docs and any(word in q for word in ["how many", "count", "number of"]):
        answer = f"You currently have {len(docs)} document(s) in your workspace."
        return {"data": {"answer": answer, "document_count": len(docs), "sources": []}}

    if mentions_docs and any(word in q for word in ["latest", "most recent", "newest", "last uploaded"]):
        answer = f"Your most recently uploaded document is \"{docs[0]['name']}\" ({docs[0]['size']})."
        return {"data": {"answer": answer, "document_count": len(docs), "sources": []}}

    if any(word in q for word in ["total size", "storage", "how much space"]):
        total = sum(d["size_bytes"] for d in docs)
        label = f"{total / (1024 * 1024):.2f} MB" if total >= 1024 * 1024 else f"{max(1, round(total / 1024))} KB"
        answer = f"Your documents are using {label} across {len(docs)} file(s)."
        return {"data": {"answer": answer, "document_count": len(docs), "sources": []}}

    if (mentions_docs and "list" in q) or any(
        phrase in q for phrase in ["what documents", "show my documents", "what files"]
    ):
        names = ", ".join(d["name"] for d in docs[:10])
        answer = f"Your documents: {names}."
        return {"data": {"answer": answer, "document_count": len(docs), "sources": []}}

    # Everything else goes through the real RAG pipeline: embed the query,
    # retrieve the most similar chunks from the vector store, and generate
    # a grounded answer from them.
    result = rag.answer_question(question, user_row["id"])

    return {
        "data": {
            "answer": result["answer"],
            "document_count": len(docs),
            "sources": result["sources"],
            "generated": result["generated"],
        }
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

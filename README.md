# DocuMind — Frontend + Backend (with real, local RAG)

A working full-stack app: a FastAPI backend with real authentication, file
uploads, and a genuine RAG (Retrieval-Augmented Generation) pipeline —
wired up to the React (Vite) "DocuMind" dashboard frontend.

## What's real here

- **Auth**: Register/login with email + password. Passwords are hashed
  (PBKDF2-SHA256, salted) and stored in a local SQLite database
  (`backend/app.db`, created automatically). Sessions use a random bearer
  token stored server-side — no fake "Continue to workspace" button.
- **Documents**: Uploading a file actually saves it to disk under
  `backend/uploads/<user_id>/` and records it in SQLite. The document list,
  download, and delete actions all talk to the real backend and are scoped
  per logged-in user.
- **AI Assistant — real RAG, zero API keys, zero internet dependency**
  (`backend/rag.py`), the same stages as your Assignment 2/3 notebooks:
  1. **Ingestion** — text is extracted from `.pdf` (pypdf), `.docx`
     (python-docx), `.xlsx` (openpyxl), and `.txt`/`.md`/`.csv`/`.json`
     (plain read).
  2. **Chunking** — `RecursiveCharacterTextSplitter`
     (`langchain-text-splitters`, the same tool as your assignment 3
     `/chunk` service), 800 chars / 150 overlap.
  3. **Embedding** — scikit-learn `TfidfVectorizer`. This is a deliberate
     choice over a neural embedding model (e.g. `sentence-transformers`):
     it needs **no model download and no internet access, ever** — it
     works completely offline on any machine, which matters a lot for a
     submission you need to demo reliably.
  4. **Vector store** — **FAISS** (`IndexFlatIP`, cosine similarity via
     normalized vectors), one in-memory index per user, rebuilt from
     SQLite whenever a document is uploaded or deleted.
  5. **Retrieval** — top-k most similar chunks to your question, scoped to
     your own documents only.
  6. **"Generation"** — there is intentionally **no LLM call** (no API
     key). The answer is assembled directly from the best-matching
     retrieved chunk(s), with the source filename and a similarity score
     attached. It's extractive rather than fluent generated prose, but it
     can never hallucinate — every answer is literally drawn from your own
     uploaded documents.
  - Plain workspace questions ("how many documents do I have", "list my
    files", "how much storage am I using") are answered directly from the
    database rather than through vector search — a more precise tool for
    that kind of question. Content questions ("why do volcanoes erupt",
    "how long do cats live") go through the real RAG pipeline above.

## Run it

**Backend** (terminal 1):
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```
Runs at `http://localhost:8000`. No internet access is required at any
point — everything (auth, uploads, embeddings, retrieval) runs locally.

**Frontend** (terminal 2):
```bash
cd React_Frontend
npm install
npm run dev
```
Open `http://localhost:5173`, register an account, then:
1. Upload a `.txt`/`.pdf`/`.docx` file with some real content in it.
2. Ask the assistant a question about what's actually in that file — you
   should get back an excerpt from it with a similarity score and source
   filename.
3. Ask something unrelated to your documents — it should say it couldn't
   find a good match, rather than making something up.
4. Try a workspace question like "how many documents do I have".

## API summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | no | Health check |
| POST | `/auth/register` | no | Create account, returns token |
| POST | `/auth/login` | no | Log in, returns token |
| POST | `/auth/logout` | yes | Invalidate current session |
| GET | `/auth/me` | yes | Current user info |
| GET | `/documents` | yes | List your documents (includes `indexed` / `chunk_count`) |
| POST | `/documents/upload` | yes | Upload a file (multipart) — runs the RAG ingestion pipeline |
| GET | `/documents/{id}/download` | yes | Download a file |
| DELETE | `/documents/{id}` | yes | Delete a file (also removes its chunks from the index) |
| POST | `/assistant/ask` | yes | Ask a question — real RAG retrieval over your documents |

Send the token from register/login as `Authorization: Bearer <token>`.

## Files worth knowing about

- `backend/main.py` — FastAPI app: auth, document CRUD, wires into `rag.py`
- `backend/rag.py` — the whole RAG pipeline (extraction, chunking, TF-IDF
  embedding, FAISS index, retrieval, extractive answer assembly)
- `backend/app.db` — SQLite: users, sessions, documents (auto-created)
- `backend/rag_store.db` — SQLite: document chunks used for retrieval (auto-created)
- `backend/uploads/<user_id>/` — the actual uploaded files

## Upgrading to real LLM generation later

If you get an API key (Anthropic, OpenAI, etc.), the only thing that needs
to change is `rag.build_extractive_answer()` in `backend/rag.py`: instead
of concatenating the top chunks into the answer directly, send them as
context to the LLM with the question and return its response. Retrieval
(chunking, embedding, FAISS search) doesn't need to change at all.

## Notes / what's out of scope (left as-is)

- `my-app` (Next.js) and `backend/auth.py` (a separate Flask + Google
  OAuth experiment) are untouched — not part of this working build, per
  your call to focus on the React_Frontend + FastAPI pair.
- No production deployment config (this is a local dev setup, matching
  the original project's scope).

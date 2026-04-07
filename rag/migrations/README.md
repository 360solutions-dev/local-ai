# Database migrations

Migrations run in order by filename (e.g. `001_...`, `002_...`).

## Tables required for prompts and chatbot

| Table           | Purpose |
|-----------------|--------|
| **query_history** | Optional audit log of user prompts. Columns: `id`, `query_text`, `created_at`. |
| **messages**      | Full chat history (prompts + responses). Survives reload; supports delete. Columns: `id`, `role`, `content`, `sources`, `created_at`. |

Document embeddings are stored in FAISS (local files); the LLM runs via Ollama. PostgreSQL is used for query history and persistent chat (messages).

## How to run migrations

### Option 1: Python script (uses `config.DATABASE_URL`)

From the project root with venv activated:

```bash
python run_migrations.py
```

### Option 2: psql

```bash
psql "postgresql://postgres:admin@localhost:5432/llm-ops-backend" -f migrations/001_create_query_history.sql
```

### Option 3: Your DB client

Open each `.sql` file in `migrations/` and execute it against the `llm-ops-backend` database (e.g. in the Query tab of your PostgreSQL client).

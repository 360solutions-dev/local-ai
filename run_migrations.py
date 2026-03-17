#!/usr/bin/env python3
"""Run SQL migrations in order. Uses DATABASE_URL from config."""

from pathlib import Path

from config import DATABASE_URL


def main():
    if not DATABASE_URL:
        print("DATABASE_URL is not set in config.py. Skipping migrations.")
        return

    try:
        import psycopg2
    except ImportError:
        print("Install psycopg2-binary: pip install psycopg2-binary")
        return

    migrations_dir = Path(__file__).resolve().parent / "migrations"
    if not migrations_dir.exists():
        print("migrations/ folder not found.")
        return

    sql_files = sorted(migrations_dir.glob("*.sql"))
    if not sql_files:
        print("No .sql migration files found.")
        return

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for path in sql_files:
                print(f"Running {path.name}...")
                cur.execute(path.read_text())
        conn.commit()
        print(f"Done. Ran {len(sql_files)} migration(s).")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()

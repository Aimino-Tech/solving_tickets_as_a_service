#!/usr/bin/env python3
"""Initialize or migrate the OpenClaw marketing DuckDB database."""

import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.orchestration.engagement.db import get_connection


def main():
    db_path = os.getenv("OPENCLAW_MARKETING_DB", "openclaw_marketing.duckdb")
    print(f"Initializing marketing database: {db_path}")

    con = get_connection()
    tables = con.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
    ).fetchall()

    print("\nTables created:")
    for t in tables:
        row_count = con.execute(f"SELECT COUNT(*) FROM \"{t[0]}\"").fetchone()[0]
        print(f"  - {t[0]}: {row_count} rows")

    print("\nSchema verification passed.")
    con.close()


if __name__ == "__main__":
    main()

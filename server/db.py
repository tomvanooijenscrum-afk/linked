"""SQLite-verbinding en eenvoudige migraties voor de Linked-backend."""

import sqlite3
from pathlib import Path

from flask import current_app, g

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def connect(path):
    connection = sqlite3.connect(path, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_error=None):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def migrate(path):
    """Voert ontbrekende migraties uit, op volgorde van bestandsnaam.

    Elke migratie draait in één transactie en wordt maar één keer
    uitgevoerd; opnieuw starten is dus veilig.
    """
    connection = connect(path)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " name TEXT PRIMARY KEY,"
            " applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        applied = {
            row["name"]
            for row in connection.execute("SELECT name FROM schema_migrations")
        }
        done = []
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if migration.name in applied:
                continue
            script = migration.read_text(encoding="utf-8")
            # executescript commit eerst zelf; BEGIN/COMMIT maakt het atomair.
            connection.executescript(
                "BEGIN;\n"
                + script
                + "\nINSERT INTO schema_migrations (name) VALUES ('"
                + migration.name.replace("'", "''")
                + "');\nCOMMIT;"
            )
            done.append(migration.name)
        return done
    except sqlite3.Error:
        if connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()


class transaction:
    """`with transaction(db):` — BEGIN IMMEDIATE ... COMMIT/ROLLBACK.

    IMMEDIATE neemt meteen de schrijfvergrendeling, zodat twee gelijktijdige
    registraties van dezelfde tag elkaar niet kunnen inhalen.
    """

    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.execute("BEGIN IMMEDIATE")
        return self.connection

    def __exit__(self, error_type, _error, _traceback):
        self.connection.execute("ROLLBACK" if error_type else "COMMIT")
        return False

"""Databaseverbinding en eenvoudige migraties voor de Linked-backend.

Lokaal is de database een SQLite-bestand. Is het adres een
postgres://-URL (zoals op Vercel met Neon), dan wordt Postgres gebruikt.
De rest van de code schrijft gewoon SQL met ?-parameters; dit bestand
vangt de verschillen op.
"""

import sqlite3
from pathlib import Path

from flask import current_app, g

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
POSTGRES_MIGRATIONS_DIR = MIGRATIONS_DIR / "postgres"

# Willekeurig, vast getal voor pg_advisory_xact_lock: alle schrijvende
# transacties wachten op elkaar, net als BEGIN IMMEDIATE in SQLite.
WRITE_LOCK = 4207151

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # Lokaal met alleen SQLite is psycopg niet nodig.
    psycopg = None

if psycopg is None:
    IntegrityError = sqlite3.IntegrityError
    DatabaseError = sqlite3.Error
else:
    IntegrityError = (sqlite3.IntegrityError, psycopg.IntegrityError)
    DatabaseError = (sqlite3.Error, psycopg.Error)


def is_postgres(path):
    return isinstance(path, str) and path.startswith(("postgres://", "postgresql://"))


class Row(dict):
    """Rij die zowel row["kolom"] als row[0] toestaat, net als sqlite3.Row."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def row_factory(cursor):
    make = dict_row(cursor)
    return lambda values: Row(make(values))


class PostgresConnection:
    """Dunne laag over psycopg met dezelfde vorm als een sqlite3-verbinding."""

    def __init__(self, url):
        # prepare_threshold=None: de Neon-pooler (PgBouncer) en prepared
        # statements gaan niet samen.
        self.connection = psycopg.connect(
            url, autocommit=True, prepare_threshold=None, row_factory=row_factory
        )

    def execute(self, sql, params=()):
        return self.connection.execute(sql.replace("?", "%s"), params)

    @property
    def in_transaction(self):
        status = self.connection.info.transaction_status
        return status != psycopg.pq.TransactionStatus.IDLE

    def close(self):
        self.connection.close()


def connect(path):
    if is_postgres(path):
        if psycopg is None:
            raise RuntimeError("Install psycopg to use a Postgres database.")
        return PostgresConnection(path)
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
    if is_postgres(path):
        return migrate_postgres(path)

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


def migrate_postgres(url):
    # Op Vercel kunnen meerdere functies tegelijk koud starten; de
    # vergrendeling zorgt dat er maar één de migraties uitvoert.
    connection = psycopg.connect(url, prepare_threshold=None)
    try:
        with connection.transaction():
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK,))
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " name TEXT PRIMARY KEY,"
                " applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            applied = {
                row[0] for row in connection.execute("SELECT name FROM schema_migrations")
            }
            done = []
            for migration in sorted(POSTGRES_MIGRATIONS_DIR.glob("*.sql")):
                if migration.name in applied:
                    continue
                connection.execute(migration.read_text(encoding="utf-8"))
                connection.execute(
                    "INSERT INTO schema_migrations (name) VALUES (%s)", (migration.name,)
                )
                done.append(migration.name)
        return done
    finally:
        connection.close()


class transaction:
    """`with transaction(db):` — BEGIN IMMEDIATE ... COMMIT/ROLLBACK.

    IMMEDIATE neemt meteen de schrijfvergrendeling, zodat twee gelijktijdige
    registraties van dezelfde tag elkaar niet kunnen inhalen. In Postgres
    doet een advisory lock hetzelfde.
    """

    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        if isinstance(self.connection, PostgresConnection):
            self.connection.execute("BEGIN")
            self.connection.execute("SELECT pg_advisory_xact_lock(?)", (WRITE_LOCK,))
        else:
            self.connection.execute("BEGIN IMMEDIATE")
        return self.connection

    def __exit__(self, error_type, _error, _traceback):
        self.connection.execute("ROLLBACK" if error_type else "COMMIT")
        return False

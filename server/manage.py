"""Beheeropdrachten voor de Linked-backend.

    server/.venv/bin/python -m server.manage migrate
    server/.venv/bin/python -m server.manage create-user <naam> [--role admin|volunteer]
    server/.venv/bin/python -m server.manage set-role <naam> <rol>
    server/.venv/bin/python -m server.manage list-users

Er is bewust geen registratiepagina: beheerders worden alleen op de
server zelf aangemaakt.
"""

import argparse
import getpass
import os
import sys

from .app import database_url
from .db import IntegrityError, connect, is_postgres, migrate
from .passwords import hash_password
from .wristbands import now

MIN_PASSWORD_LENGTH = 12
ROLES = ("admin", "volunteer")


def database_path():
    path = database_url()
    if not is_postgres(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def ask_password():
    password = os.getenv("LINKED_NEW_PASSWORD") or getpass.getpass("Password: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if not os.getenv("LINKED_NEW_PASSWORD") and getpass.getpass("Repeat: ") != password:
        sys.exit("Passwords do not match.")
    return password


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m server.manage")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    create = commands.add_parser("create-user")
    create.add_argument("username")
    create.add_argument("--role", choices=ROLES, default="admin")
    role = commands.add_parser("set-role")
    role.add_argument("username")
    role.add_argument("role", choices=ROLES)
    commands.add_parser("list-users")
    args = parser.parse_args(argv)

    path = database_path()
    applied = migrate(path)
    if args.command == "migrate":
        print("Applied: " + (", ".join(applied) if applied else "nothing new"))
        return

    db = connect(path)
    try:
        if args.command == "create-user":
            password_hash = hash_password(ask_password())
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash, role, created_at)"
                    " VALUES (?, ?, ?, ?)",
                    (args.username, password_hash, args.role, now()),
                )
            except IntegrityError:
                sys.exit("That username already exists or is invalid (3-40 characters).")
            print(f"Created {args.role} '{args.username}'.")
        elif args.command == "set-role":
            changed = db.execute(
                "UPDATE users SET role = ? WHERE username = ?", (args.role, args.username)
            ).rowcount
            if not changed:
                sys.exit("No such user.")
            print(f"'{args.username}' is now {args.role}.")
        elif args.command == "list-users":
            for row in db.execute("SELECT username, role, created_at FROM users ORDER BY id"):
                print(f"{row['username']:<24} {row['role']:<10} {row['created_at']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()

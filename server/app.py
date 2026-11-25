"""Linked-backend: beheerders-API voor NFC-polsbanden en de webapp zelf.

Starten (vanuit de map linked):
    server/.venv/bin/python -m server.app

Zie server/README.md voor configuratie en beheerdersaccounts.
"""

import os
import re
import secrets
import time
from functools import wraps
from pathlib import Path

from flask import Flask, abort, current_app, g, jsonify, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix

from . import wristbands
from .db import IntegrityError, close_db, get_db, is_postgres, migrate
from .passwords import verify_password

ROOT = Path(__file__).resolve().parent.parent
INSTANCE = Path(__file__).resolve().parent / "instance"

# Alleen de bestanden van de webapp zelf, nooit server/, nfc/ of .git.
STATIC_FILE = re.compile(r"^(i18n/)?[A-Za-z0-9_-]+\.(html|css|js|svg|png|ico|webmanifest)$")

LOGIN_WINDOW = 15 * 60
LOGIN_MAX_FAILURES = 5


def database_url():
    # DATABASE_URL zet de Neon-integratie van Vercel zelf.
    return (
        os.getenv("LINKED_DATABASE")
        or os.getenv("DATABASE_URL")
        or str(INSTANCE / "linked.sqlite3")
    )


def load_secret_key():
    key = os.getenv("LINKED_SECRET_KEY")
    if key:
        return key
    if os.getenv("VERCEL"):
        # Op Vercel is de schijf alleen-lezen en per functie anders.
        raise RuntimeError("Set LINKED_SECRET_KEY in the Vercel project settings.")
    # Ontwikkeling: één keer een willekeurige sleutel maken en bewaren.
    INSTANCE.mkdir(exist_ok=True)
    path = INSTANCE / "secret_key"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        path.chmod(0o600)
    return path.read_text().strip()


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(
        DATABASE=database_url(),
        PUBLIC_BASE_URL=os.getenv("LINKED_PUBLIC_BASE_URL", ""),
        SESSION_COOKIE_NAME="linked_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        SESSION_COOKIE_SECURE=os.getenv("LINKED_SECURE_COOKIES") == "1",
        PERMANENT_SESSION_LIFETIME=8 * 60 * 60,
        MAX_CONTENT_LENGTH=16 * 1024,
    )
    if config:
        app.config.update(config)
    if not app.config.get("SECRET_KEY"):
        app.config["SECRET_KEY"] = load_secret_key()

    if not is_postgres(app.config["DATABASE"]):
        Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    migrate(app.config["DATABASE"])

    if os.getenv("VERCEL") or os.getenv("LINKED_BEHIND_PROXY") == "1":
        # Achter de proxy van Vercel: echte https-adres en IP van de bezoeker,
        # nodig voor de Origin-controle en de inlogbeperking.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    app.teardown_appcontext(close_db)
    app.extensions["login_failures"] = {}
    register_routes(app)
    return app


def api_error(code, status, **extra):
    return jsonify({"ok": False, "error": code, **extra}), status


def base_url():
    url = wristbands.normalise_base_url(current_app.config["PUBLIC_BASE_URL"])
    if url is None:
        raise wristbands.WristbandError("PUBLIC_URL_NOT_CONFIGURED", 503)
    return url


def current_user():
    if "user" not in g:
        user_id = session.get("user_id")
        g.user = None
        if user_id is not None:
            # Elke keer opnieuw uit de database: een ingetrokken rol of
            # verwijderd account werkt meteen door.
            g.user = get_db().execute(
                "SELECT id, username, role FROM users WHERE id = ?", (user_id,)
            ).fetchone()
    return g.user


def require_role(role):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = current_user()
            if user is None:
                return api_error("NOT_SIGNED_IN", 401)
            if user["role"] != role:
                return api_error("FORBIDDEN", 403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def json_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise wristbands.WristbandError("INVALID_JSON", 400)
    return body


def register_routes(app):
    @app.errorhandler(wristbands.WristbandError)
    def handle_wristband_error(error):
        return api_error(error.code, error.status, **error.extra)

    @app.errorhandler(413)
    def too_large(_error):
        return api_error("REQUEST_TOO_LARGE", 413)

    @app.before_request
    def protect_against_csrf():
        # Een eigen header kan een andere website niet meesturen zonder
        # CORS-toestemming, en die geven we niet. Samen met SameSite=Strict.
        if request.path.startswith("/api/") and request.method not in ("GET", "HEAD"):
            if request.headers.get("X-Linked-Request") != "1":
                return api_error("CSRF_HEADER_MISSING", 403)
            origin = request.headers.get("Origin")
            if origin and origin != request.host_url.rstrip("/"):
                return api_error("CROSS_ORIGIN", 403)
        return None

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        # De link op een polsbandje bevat een token: nooit doorgeven.
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    # ---- Inloggen -------------------------------------------------------

    def login_key():
        return request.remote_addr or "unknown"

    def recent_failures(key):
        failures = app.extensions["login_failures"]
        cutoff = time.monotonic() - LOGIN_WINDOW
        failures[key] = [t for t in failures.get(key, []) if t > cutoff]
        return failures[key]

    @app.post("/api/auth/login")
    def login():
        key = login_key()
        if len(recent_failures(key)) >= LOGIN_MAX_FAILURES:
            return api_error("TOO_MANY_ATTEMPTS", 429)

        body = json_body()
        username = body.get("username")
        password = body.get("password")
        user = None
        if isinstance(username, str) and isinstance(password, str):
            user = get_db().execute(
                "SELECT id, username, role, password_hash FROM users WHERE username = ?",
                (username.strip(),),
            ).fetchone()
        if user is None or not verify_password(user["password_hash"], password):
            recent_failures(key).append(time.monotonic())
            return api_error("INVALID_CREDENTIALS", 401)

        recent_failures(key).clear()
        session.clear()
        session.permanent = True
        session["user_id"] = user["id"]
        return jsonify({"ok": True, "user": {"username": user["username"], "role": user["role"]}})

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/api/auth/me")
    def me():
        user = current_user()
        if user is None:
            return api_error("NOT_SIGNED_IN", 401)
        return jsonify({"ok": True, "user": {"username": user["username"], "role": user["role"]}})

    # ---- Evenementen ----------------------------------------------------

    @app.get("/api/events")
    @require_role("admin")
    def list_events():
        rows = get_db().execute("SELECT id, name FROM events ORDER BY name").fetchall()
        return jsonify({"ok": True, "events": [dict(row) for row in rows]})

    @app.post("/api/events")
    @require_role("admin")
    def create_event():
        name = json_body().get("name")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            return api_error("INVALID_EVENT_NAME", 400)
        db = get_db()
        try:
            event_id = db.execute(
                "INSERT INTO events (name, created_at) VALUES (?, ?) RETURNING id",
                (name.strip(), wristbands.now()),
            ).fetchone()[0]
        except IntegrityError:
            return api_error("DUPLICATE_EVENT", 409)
        return jsonify({"ok": True, "event": {"id": event_id, "name": name.strip()}}), 201

    # ---- Polsbanden (alleen beheerders) ---------------------------------

    @app.get("/api/wristbands")
    @require_role("admin")
    def list_wristbands():
        event_id = request.args.get("eventId", type=int)
        rows = wristbands.search(
            get_db(),
            query=request.args.get("q", ""),
            status=request.args.get("status", "all"),
            event_id=event_id,
        )
        return jsonify({"ok": True, "wristbands": [wristbands.serialise(r) for r in rows]})

    @app.get("/api/wristbands/lookup")
    @require_role("admin")
    def lookup_wristband():
        uid = wristbands.normalise_uid(request.args.get("uid"))
        if uid is None:
            return api_error("INVALID_UID", 400)
        row = wristbands.find_by_uid(get_db(), uid)
        return jsonify({"ok": True, "wristband": wristbands.serialise(row)})

    @app.post("/api/wristbands/reserve")
    @require_role("admin")
    def reserve_wristband():
        body = json_body()
        result = wristbands.reserve(
            get_db(),
            uid=body.get("uid"),
            user_id=current_user()["id"],
            base_url=base_url(),
            event_id=body.get("eventId"),
        )
        return jsonify({"ok": True, **result}), (200 if result["retry"] else 201)

    @app.post("/api/wristbands/<wristband_id>/failure")
    @require_role("admin")
    def wristband_failure(wristband_id):
        body = json_body()
        row = wristbands.record_failure(
            get_db(), wristband_id, body.get("stage"), body.get("error")
        )
        return jsonify({"ok": True, "wristband": row})

    @app.post("/api/wristbands/<wristband_id>/confirm")
    @require_role("admin")
    def confirm_wristband(wristband_id):
        body = json_body()
        result = wristbands.confirm(
            get_db(), wristband_id, body.get("uid"), body.get("url"), base_url()
        )
        return jsonify({"ok": True, **result})

    @app.post("/api/wristbands/<wristband_id>/activate")
    @require_role("admin")
    def activate_wristband(wristband_id):
        row = wristbands.set_active(get_db(), wristband_id, True)
        return jsonify({"ok": True, "wristband": row})

    @app.post("/api/wristbands/<wristband_id>/deactivate")
    @require_role("admin")
    def deactivate_wristband(wristband_id):
        row = wristbands.set_active(get_db(), wristband_id, False)
        return jsonify({"ok": True, "wristband": row})

    @app.delete("/api/wristbands/<wristband_id>")
    @require_role("admin")
    def discard_wristband(wristband_id):
        wristbands.discard(get_db(), wristband_id)
        return jsonify({"ok": True})

    # ---- Openbaar: wordt aangeroepen na het aantikken -------------------

    @app.get("/api/wristbands/resolve")
    def resolve_wristband():
        result = wristbands.resolve(get_db(), request.args.get("t"))
        return jsonify({"ok": True, **result})

    # ---- De webapp zelf -------------------------------------------------

    @app.get("/")
    def index():
        return send_from_directory(ROOT, "index.html")

    @app.get("/<path:filename>")
    def static_file(filename):
        if filename.startswith("api/") or not STATIC_FILE.match(filename):
            abort(404)
        return send_from_directory(ROOT, filename)


if __name__ == "__main__":
    # Alleen op deze computer luisteren. Web Serial werkt op localhost
    # zonder HTTPS; telefoons hebben een HTTPS-adres nodig (zie README).
    create_app().run(
        host=os.getenv("LINKED_HOST", "127.0.0.1"),
        port=int(os.getenv("LINKED_PORT", "8000")),
    )

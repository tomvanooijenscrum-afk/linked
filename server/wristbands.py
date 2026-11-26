"""Registratie en beheer van NFC-polsbanden.

Belangrijk: de UID en het token op de tag zijn géén inloggegevens. De UID
is te kopiëren en de link staat leesbaar op de tag. Het token bepaalt
alleen of de hulppagina het bandje herkent; het geeft nergens toegang toe.
"""

import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

from .db import transaction

# 16 willekeurige bytes = 128 bits, base64url = 22 tekens.
TOKEN_BYTES = 16
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{22}$")
UID_PATTERN = re.compile(r"^[0-9A-F]{14}$")
ERROR_CODE_PATTERN = re.compile(r"^[A-Z0-9_]{1,40}$")
# Moet overeenkomen met LINKED_MAX_URL_SUFFIX in de firmware.
MAX_URL_SUFFIX = 136

FILTERS = {
    "all": "1 = 1",
    "active": "w.is_active = 1",
    "inactive": "w.write_status = 'verified' AND w.is_active = 0",
    "pending": "w.write_status = 'reserved'",
    "failed": "w.write_status = 'failed'",
}


class WristbandError(Exception):
    def __init__(self, code, status=409, **extra):
        super().__init__(code)
        self.code = code
        self.status = status
        self.extra = extra


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_token(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def new_token():
    return secrets.token_urlsafe(TOKEN_BYTES)


def normalise_uid(uid):
    if not isinstance(uid, str):
        return None
    uid = uid.strip().upper().replace(":", "").replace(" ", "")
    return uid if UID_PATTERN.match(uid) else None


def normalise_base_url(url):
    """Geeft de basis-URL zonder slash aan het eind, of None."""
    if not isinstance(url, str):
        return None
    url = url.strip().rstrip("/")
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.query
        or parts.fragment
        or parts.username
        or parts.password
        or any(c.isspace() for c in url)
    ):
        return None
    if len(build_url(url, "x" * 22)) - len("https://") > MAX_URL_SUFFIX:
        return None
    return url


def build_url(base_url, token):
    # Een query string werkt ook op een statische host.
    return f"{base_url}/?t={token}"


def token_from_url(base_url, url):
    """Haalt het token uit een teruggelezen link van déze Linked-omgeving."""
    if not isinstance(url, str) or not url.startswith(base_url + "/?"):
        return None
    values = parse_qs(urlsplit(url).query).get("t", [])
    if len(values) != 1 or not TOKEN_PATTERN.match(values[0]):
        return None
    token = values[0]
    return token if build_url(base_url, token) == url else None


def label(number):
    return f"WB-{number:04d}"


SELECT_WRISTBAND = """
SELECT w.*, e.name AS event_name, u.username AS registered_by_name
FROM wristbands w
LEFT JOIN events e ON e.id = w.event_id
JOIN users u ON u.id = w.registered_by
"""


def serialise(row):
    if row is None:
        return None
    return {
        "id": row["id"],
        "label": label(row["number"]),
        "tagUid": row["tag_uid"],
        "eventId": row["event_id"],
        "eventName": row["event_name"],
        "writeStatus": row["write_status"],
        "isActive": bool(row["is_active"]),
        "writeAttempts": row["write_attempts"],
        "lastError": row["last_error"],
        "registeredBy": row["registered_by_name"],
        "registeredAt": row["registered_at"],
        "verifiedAt": row["verified_at"],
        "activatedAt": row["activated_at"],
        "deactivatedAt": row["deactivated_at"],
    }


def get(db, wristband_id):
    return db.execute(SELECT_WRISTBAND + " WHERE w.id = ?", (wristband_id,)).fetchone()


def get_required(db, wristband_id):
    row = get(db, wristband_id) if isinstance(wristband_id, str) else None
    if row is None:
        raise WristbandError("NOT_FOUND", 404)
    return row


def find_by_uid(db, uid):
    return db.execute(SELECT_WRISTBAND + " WHERE w.tag_uid = ?", (uid,)).fetchone()


def search(db, query="", status="all", event_id=None, limit=500):
    if status not in FILTERS:
        raise WristbandError("INVALID_FILTER", 400)
    where = [FILTERS[status]]
    params = []

    query = (query or "").strip()[:40]
    if query:
        # WB-0012, 12 of een deel van de UID.
        digits = re.sub(r"^WB-?", "", query, flags=re.IGNORECASE)
        escaped = query.upper().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clause = "w.tag_uid LIKE ? ESCAPE '\\' OR e.name LIKE ? ESCAPE '\\'"
        params += [f"%{escaped}%", f"%{escaped}%"]
        if digits.isdigit():
            clause += " OR w.number = ?"
            params.append(int(digits))
        where.append(f"({clause})")

    if event_id is not None:
        where.append("w.event_id = ?")
        params.append(event_id)

    sql = SELECT_WRISTBAND + " WHERE " + " AND ".join(where) + " ORDER BY w.number DESC LIMIT ?"
    params.append(limit)
    return db.execute(sql, params).fetchall()


def check_event(db, event_id):
    if event_id is None:
        return None
    if not isinstance(event_id, int) or isinstance(event_id, bool):
        raise WristbandError("INVALID_EVENT", 400)
    if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise WristbandError("INVALID_EVENT", 400)
    return event_id


def reserve(db, uid, user_id, base_url, event_id=None):
    """Stap 6-7: controleer op dubbele registratie en reserveer een token.

    Een eerdere, niet-afgeronde registratie van dezelfde tag krijgt een
    nieuw token (het oude wordt ongeldig). Zo is opnieuw proberen na een
    onderbreking veilig en kan er nooit een tweede record ontstaan.
    """
    uid = normalise_uid(uid)
    if uid is None:
        raise WristbandError("INVALID_UID", 400)

    token = new_token()
    timestamp = now()

    with transaction(db):
        event_id = check_event(db, event_id)
        existing = find_by_uid(db, uid)

        if existing is not None and existing["write_status"] == "verified":
            raise WristbandError("DUPLICATE_TAG", 409, wristband=serialise(existing))

        if existing is not None:
            db.execute(
                "UPDATE wristbands SET token_hash = ?, write_status = 'reserved',"
                " write_attempts = write_attempts + 1, event_id = ?,"
                " registered_by = ?, updated_at = ? WHERE id = ?",
                (hash_token(token), event_id, user_id, timestamp, existing["id"]),
            )
            wristband_id = existing["id"]
            retry = True
        else:
            number = db.execute(
                "SELECT COALESCE(MAX(number), 0) + 1 FROM wristbands"
            ).fetchone()[0]
            wristband_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO wristbands (id, number, tag_uid, token_hash, event_id,"
                " registered_by, registered_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (wristband_id, number, uid, hash_token(token), event_id,
                 user_id, timestamp, timestamp),
            )
            retry = False

        row = get(db, wristband_id)

    return {
        "wristband": serialise(row),
        # Het enige moment waarop het token bestaat buiten de tag.
        "url": build_url(base_url, token),
        "retry": retry,
    }


def record_failure(db, wristband_id, stage, error):
    if stage not in ("write", "verify"):
        raise WristbandError("INVALID_STAGE", 400)
    if not isinstance(error, str) or not ERROR_CODE_PATTERN.match(error):
        raise WristbandError("INVALID_ERROR_CODE", 400)

    with transaction(db):
        row = get_required(db, wristband_id)
        if row["write_status"] == "verified":
            raise WristbandError("ALREADY_VERIFIED", 409, wristband=serialise(row))
        db.execute(
            "UPDATE wristbands SET write_status = 'failed', last_error = ?,"
            " updated_at = ? WHERE id = ?",
            (f"{stage}:{error}", now(), wristband_id),
        )
        return serialise(get(db, wristband_id))


def confirm(db, wristband_id, uid, url, base_url):
    """Stap 10-11: bevestig de teruggelezen link. Idempotent."""
    uid = normalise_uid(uid)
    if uid is None:
        raise WristbandError("INVALID_UID", 400)

    with transaction(db):
        row = get_required(db, wristband_id)
        if row["tag_uid"] != uid:
            raise WristbandError("UID_MISMATCH", 409)

        token = token_from_url(base_url, url)
        if token is None or not hmac.compare_digest(hash_token(token), row["token_hash"]):
            # Bijvoorbeeld een oude link van vóór een nieuwe poging.
            raise WristbandError("URL_MISMATCH", 409)

        if row["write_status"] == "verified":
            return {"wristband": serialise(row), "alreadyConfirmed": True}

        timestamp = now()
        db.execute(
            "UPDATE wristbands SET write_status = 'verified', last_error = NULL,"
            " verified_at = ?, updated_at = ? WHERE id = ?",
            (timestamp, timestamp, wristband_id),
        )
        return {"wristband": serialise(get(db, wristband_id)), "alreadyConfirmed": False}


def set_active(db, wristband_id, active):
    with transaction(db):
        row = get_required(db, wristband_id)
        if active and row["write_status"] != "verified":
            raise WristbandError("NOT_VERIFIED", 409)
        if bool(row["is_active"]) == active:
            return serialise(row)
        timestamp = now()
        column = "activated_at" if active else "deactivated_at"
        db.execute(
            f"UPDATE wristbands SET is_active = ?, {column} = ?, updated_at = ?"
            " WHERE id = ?",
            (int(active), timestamp, timestamp, wristband_id),
        )
        return serialise(get(db, wristband_id))


def discard(db, wristband_id):
    """Verwijdert een niet-afgeronde reservering. Bevestigde bandjes blijven."""
    with transaction(db):
        row = get_required(db, wristband_id)
        if row["write_status"] == "verified":
            raise WristbandError("ALREADY_VERIFIED", 409)
        db.execute("DELETE FROM wristbands WHERE id = ?", (wristband_id,))


def resolve(db, token):
    """Openbaar: hoort dit token bij een actief bandje?"""
    if not isinstance(token, str) or not TOKEN_PATTERN.match(token):
        return {"status": "unknown"}
    row = db.execute(
        "SELECT w.write_status, w.is_active, e.name AS event_name"
        " FROM wristbands w LEFT JOIN events e ON e.id = w.event_id"
        " WHERE w.token_hash = ?",
        (hash_token(token),),
    ).fetchone()
    if row is None or row["write_status"] != "verified":
        return {"status": "unknown"}
    if not row["is_active"]:
        return {"status": "inactive"}
    return {"status": "active", "eventName": row["event_name"]}

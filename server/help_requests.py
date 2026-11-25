"""Hulpaanvragen die alle vrijwilligers op elk apparaat zien.

De aanvrager heeft geen account. Bij het aanmaken krijgt die een geheim
terug; alleen met dat geheim kan de aanvrager de status volgen of
annuleren. Vrijwilligers en beheerders zien de lijst en kunnen accepteren.
"""

import hmac
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from . import wristbands
from .db import transaction
from .wristbands import WristbandError, hash_token

# Alle locaties zijn hypothetisch: een willekeurig punt op 0,3–3 km van
# Fontys Rachelsmolen in Eindhoven (zelfde regel als vroeger in de browser).
CENTER = (51.4516, 5.4816)
MIN_DISTANCE = 300
MAX_DISTANCE = 3000
METERS_PER_DEGREE = 111320

# Afgehandelde aanvragen blijven nog even zichtbaar voor vrijwilligers.
ACCEPTED_VISIBLE_FOR = timedelta(hours=2)
# Rem op misbruik van het openbare aanmaken.
MAX_PENDING = 100
LIST_LIMIT = 100

def now():
    # Microseconden: de volgorde van binnenkomst moet exact zijn.
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


SELECT_REQUEST = """
SELECT r.*, w.number AS wristband_number, e.name AS event_name,
       u.username AS accepted_by_name
FROM help_requests r
LEFT JOIN wristbands w ON w.id = r.wristband_id
LEFT JOIN events e ON e.id = w.event_id
LEFT JOIN users u ON u.id = r.accepted_by
"""


def simulate_location():
    rng = secrets.SystemRandom()
    angle = rng.random() * 2 * math.pi
    distance = MIN_DISTANCE + rng.random() * (MAX_DISTANCE - MIN_DISTANCE)
    latitude, longitude = CENTER
    return (
        latitude + distance * math.cos(angle) / METERS_PER_DEGREE,
        longitude
        + distance * math.sin(angle) / (METERS_PER_DEGREE * math.cos(math.radians(latitude))),
    )


def get(db, request_id):
    if not isinstance(request_id, str):
        return None
    return db.execute(SELECT_REQUEST + " WHERE r.id = ?", (request_id,)).fetchone()


def get_required(db, request_id):
    row = get(db, request_id)
    if row is None:
        raise WristbandError("NOT_FOUND", 404)
    return row


def for_requester(row):
    return {
        "id": row["id"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "acceptedAt": row["accepted_at"],
        "cancelledAt": row["cancelled_at"],
    }


def for_volunteer(row, user_id):
    number = row["wristband_number"]
    return {
        "id": row["id"],
        "status": row["status"],
        "source": row["source"],
        "wristbandLabel": wristbands.label(number) if number is not None else None,
        "eventName": row["event_name"],
        "tagUid": row["tag_uid"],
        "location": {"latitude": row["latitude"], "longitude": row["longitude"]},
        "createdAt": row["created_at"],
        "acceptedAt": row["accepted_at"],
        "acceptedBy": row["accepted_by_name"],
        "acceptedByMe": row["accepted_by"] is not None and row["accepted_by"] == user_id,
    }


def check_secret(row, secret):
    if not isinstance(secret, str) or not hmac.compare_digest(
        hash_token(secret), row["secret_hash"]
    ):
        # Zelfde antwoord als een onbekende aanvraag: verraadt niets.
        raise WristbandError("NOT_FOUND", 404)


def create(db, token=None, tag_uid=None):
    """Nieuwe aanvraag. token: van een polsbandjeslink; tag_uid: van een lezer."""
    wristband_id = None
    source = "app"

    if tag_uid is not None:
        tag_uid = wristbands.normalise_uid(tag_uid)
        if tag_uid is None:
            raise WristbandError("INVALID_UID", 400)
        source = "reader"
        row = wristbands.find_by_uid(db, tag_uid)
        if row is not None and row["write_status"] == "verified":
            wristband_id = row["id"]
    elif token is not None:
        if not isinstance(token, str) or not wristbands.TOKEN_PATTERN.match(token):
            raise WristbandError("INVALID_TOKEN", 400)
        row = db.execute(
            "SELECT id, write_status, is_active FROM wristbands WHERE token_hash = ?",
            (hash_token(token),),
        ).fetchone()
        # Alleen een actief bandje telt; anders is het een gewone aanvraag.
        if row is not None and row["write_status"] == "verified" and row["is_active"]:
            wristband_id = row["id"]
            source = "wristband"

    secret = secrets.token_urlsafe(24)
    request_id = str(uuid.uuid4())
    latitude, longitude = simulate_location()
    timestamp = now()

    with transaction(db):
        pending = db.execute(
            "SELECT COUNT(*) FROM help_requests WHERE status = 'pending'"
        ).fetchone()[0]
        if pending >= MAX_PENDING:
            raise WristbandError("TOO_MANY_PENDING", 503)
        db.execute(
            "INSERT INTO help_requests (id, secret_hash, source, wristband_id, tag_uid,"
            " latitude, longitude, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (request_id, hash_token(secret), source, wristband_id, tag_uid,
             latitude, longitude, timestamp, timestamp),
        )
        row = get(db, request_id)

    return {"request": for_requester(row), "secret": secret}


def status(db, request_id, secret):
    row = get_required(db, request_id)
    check_secret(row, secret)
    return for_requester(row)


def cancel(db, request_id, secret):
    with transaction(db):
        row = get_required(db, request_id)
        check_secret(row, secret)
        if row["status"] == "cancelled":
            return for_requester(row)
        timestamp = now()
        db.execute(
            "UPDATE help_requests SET status = 'cancelled', cancelled_at = ?,"
            " updated_at = ? WHERE id = ?",
            (timestamp, timestamp, request_id),
        )
        return for_requester(get(db, request_id))


def accept(db, request_id, user_id):
    """Wie het eerst komt: een tweede vrijwilliger krijgt ALREADY_ACCEPTED."""
    with transaction(db):
        row = get_required(db, request_id)
        if row["status"] == "cancelled":
            raise WristbandError("REQUEST_CANCELLED", 409)
        if row["status"] == "accepted":
            if row["accepted_by"] == user_id:
                return for_volunteer(row, user_id)
            raise WristbandError(
                "ALREADY_ACCEPTED", 409, request=for_volunteer(row, user_id)
            )
        timestamp = now()
        db.execute(
            "UPDATE help_requests SET status = 'accepted', accepted_by = ?,"
            " accepted_at = ?, updated_at = ? WHERE id = ?",
            (user_id, timestamp, timestamp, request_id),
        )
        return for_volunteer(get(db, request_id), user_id)


def list_open(db, user_id):
    """Wachtende aanvragen en recent geaccepteerde, oudste eerst."""
    since = (datetime.now(timezone.utc) - ACCEPTED_VISIBLE_FOR).isoformat(timespec="microseconds")
    rows = db.execute(
        SELECT_REQUEST
        + " WHERE r.status = 'pending' OR (r.status = 'accepted' AND r.accepted_at >= ?)"
        " ORDER BY r.created_at, r.id LIMIT ?",
        (since, LIST_LIMIT),
    ).fetchall()
    return [for_volunteer(row, user_id) for row in rows]


def clear(db):
    """Beheerder: alle aanvragen weg (bijvoorbeeld na een demo)."""
    with transaction(db):
        return db.execute("DELETE FROM help_requests").rowcount

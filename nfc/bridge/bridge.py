"""Lokale brug tussen de Linked-webapp en de Arduino NFC-schrijver.

Alleen bedoeld voor een vertrouwde ontwikkelcomputer. CORS is geen
authenticatie: stel deze brug nooit open via een publieke tunnel.
"""

import os
import re
import threading
import time
from collections import deque

import serial
from flask import Flask, jsonify, request
from flask_cors import CORS

ARDUINO_PORT = os.getenv("ARDUINO_PORT", "/dev/cu.usbserial-120")
BRIDGE_PORT = int(os.getenv("BRIDGE_PORT", "5001"))
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://127.0.0.1:5501,http://localhost:5501,"
    "http://127.0.0.1:5504,http://localhost:5504",
).split(",")

# De firmware past maximaal 40 tekens na "https://" in 48 bytes.
MAX_URL_SUFFIX = 40
URL_PATTERN = re.compile(r"^https://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$")

# Wachten op een tag duurt 3 s in de firmware; schrijven en
# verifiëren komt daar nog bij.
COMMAND_TIMEOUT = 10

# Tikken: dezelfde tag die blijft liggen telt als één tik. Zonder
# vrijwilligerspagina die naar tikken vraagt, stopt het scannen.
TAP_DEBOUNCE = 3
WATCH_IDLE = 10
WATCH_TIMEOUT = 5

app = Flask(__name__)
CORS(app, origins=ALLOWED_ORIGINS)

arduino = None
serial_lock = threading.Lock()
# Gezet zolang een opdracht van de webapp wacht; het scannen wijkt dan.
command_waiting = threading.Event()

taps = deque(maxlen=50)
tap_lock = threading.Lock()
tap_state = {
    "next_id": 1,
    "last_uid": None,
    "last_seen": 0.0,
    "last_poll": 0.0,
    "reader": "starting",
}


def connect_arduino():
    global arduino

    if arduino is None or not arduino.is_open:
        arduino = serial.Serial(ARDUINO_PORT, 115200, timeout=1)
        # De Uno herstart wanneer de seriële poort opent.
        time.sleep(2)
        arduino.reset_input_buffer()

    return arduino


def validate_url(url):
    """Geeft een foutcode terug, of None als de URL past."""
    if not isinstance(url, str) or not url.startswith("https://"):
        return "HTTPS_REQUIRED"
    if len(url) - len("https://") > MAX_URL_SUFFIX:
        return "URL_TOO_LONG"
    if not URL_PATTERN.match(url):
        return "INVALID_URL"
    return None


def send_command(connection, command, timeout=COMMAND_TIMEOUT):
    """Stuurt één opdracht en leest regels tot SUCCESS: of ERROR:."""
    connection.write(f"{command}\n".encode("ascii"))
    connection.flush()

    lines = []
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        raw = connection.readline()
        if not raw:
            continue

        line = raw.decode("ascii", errors="replace").strip()
        # De opstartregel kan na een herstart nog binnenkomen.
        if not line or line.startswith("READY:"):
            continue

        lines.append(line)
        if line.startswith("SUCCESS:") or line.startswith("ERROR:"):
            break

    return lines


def parse_response(lines):
    """Zet de regels van de firmware om naar een JSON-antwoord."""
    body = {"ok": False, "lines": lines}

    for line in lines:
        if line.startswith("UID:"):
            body["uid"] = line[len("UID:"):]

    last = lines[-1] if lines else ""

    if last.startswith("SUCCESS:"):
        body["ok"] = True
        body["result"] = last[len("SUCCESS:"):]
        for prefix in ("URL:", "WRITTEN:"):
            if body["result"].startswith(prefix):
                body["url"] = body["result"][len(prefix):]
    elif last.startswith("ERROR:"):
        body["error"] = last[len("ERROR:"):]
    else:
        body["error"] = "TIMEOUT"

    return body


def run(command):
    global arduino

    command_waiting.set()
    try:
        with serial_lock:
            lines = send_command(connect_arduino(), command)
    except (serial.SerialException, OSError) as error:
        # Volgende keer opnieuw verbinden, bijvoorbeeld na loskoppelen.
        arduino = None
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "ARDUINO_NOT_CONNECTED",
                    "detail": str(error),
                }
            ),
            503,
        )
    finally:
        command_waiting.clear()

    body = parse_response(lines)
    return jsonify(body), 200


def record_tap(uid, now):
    """Bewaart een nieuwe tik, of None als dezelfde tag nog ligt."""
    with tap_lock:
        still_present = (
            uid == tap_state["last_uid"]
            and now - tap_state["last_seen"] < TAP_DEBOUNCE
        )
        tap_state["last_uid"] = uid
        tap_state["last_seen"] = now
        if still_present:
            return None

        tap = {
            "id": tap_state["next_id"],
            "uid": uid,
            "at": int(time.time() * 1000),
        }
        tap_state["next_id"] += 1
        taps.append(tap)
        return tap


def watch_once():
    """Eén SCAN-ronde; geeft een nieuwe tik terug of None."""
    global arduino

    try:
        with serial_lock:
            lines = send_command(connect_arduino(), "SCAN", WATCH_TIMEOUT)
    except (serial.SerialException, OSError):
        arduino = None
        tap_state["reader"] = "disconnected"
        return None

    tap_state["reader"] = "listening"
    body = parse_response(lines)
    if body["ok"] and body.get("uid"):
        return record_tap(body["uid"], time.monotonic())
    return None


def watch_taps():
    while True:
        is_watched = time.monotonic() - tap_state["last_poll"] < WATCH_IDLE
        if not is_watched or command_waiting.is_set():
            time.sleep(0.2)
            continue

        watch_once()
        if tap_state["reader"] == "disconnected":
            # Niet blijven proberen terwijl de poort bezet of los is.
            time.sleep(2)


@app.get("/api/nfc/taps")
def tap_events():
    after = request.args.get("after", type=int)
    with tap_lock:
        tap_state["last_poll"] = time.monotonic()
        latest = tap_state["next_id"] - 1
        new_taps = (
            [] if after is None else [tap for tap in taps if tap["id"] > after]
        )

    return jsonify(
        {
            "ok": True,
            "taps": new_taps,
            "latest": latest,
            "reader": tap_state["reader"],
        }
    )


@app.get("/api/nfc/status")
def status():
    return run("PING")


@app.post("/api/nfc/scan")
def scan():
    return run("SCAN")


@app.post("/api/nfc/read")
def read():
    return run("READ")


@app.post("/api/nfc/write")
def write():
    url = (request.get_json(silent=True) or {}).get("url")
    error = validate_url(url)
    if error:
        return jsonify({"ok": False, "error": error}), 400

    return run(f"WRITE:{url}")


if __name__ == "__main__":
    threading.Thread(target=watch_taps, daemon=True).start()
    # Alleen luisteren op deze computer, nooit op het netwerk.
    app.run(host="127.0.0.1", port=BRIDGE_PORT)

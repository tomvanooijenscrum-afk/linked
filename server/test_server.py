"""Backendtests zonder netwerk of Arduino.

    server/.venv/bin/python -m unittest server.test_server -v
"""

import sqlite3
import tempfile
import unittest
from pathlib import Path

from server import wristbands
from server.app import create_app
from server.db import connect, migrate
from server.passwords import hash_password

BASE = "https://linked.example"
UID = "04A39B127C8091"
OTHER_UID = "04B1C2D3E4F501"
HEADERS = {"X-Linked-Request": "1"}
# Eén keer hashen: 600.000 PBKDF2-rondes per test is traag.
PASSWORD_HASH = hash_password("correct horse battery")


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "test.sqlite3")
        self.app = create_app({
            "DATABASE": self.db_path,
            "SECRET_KEY": "test",
            "PUBLIC_BASE_URL": BASE,
            "TESTING": True,
        })
        db = connect(self.db_path)
        for name, role in (("admin", "admin"), ("helper", "volunteer"), ("admin2", "admin")):
            db.execute(
                "INSERT INTO users (username, password_hash, role, created_at)"
                " VALUES (?, ?, ?, '2026-01-01')",
                (name, PASSWORD_HASH, role),
            )
        db.close()
        self.client = self.app.test_client()

    def tearDown(self):
        self.tmp.cleanup()

    # -- hulpfuncties ----------------------------------------------------

    def login(self, username="admin", client=None):
        client = client or self.client
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": "correct horse battery"},
            headers=HEADERS,
        )
        self.assertEqual(response.status_code, 200, response.json)
        return client

    def post(self, path, body=None, client=None):
        return (client or self.client).post(path, json=body or {}, headers=HEADERS)

    def register(self, uid=UID, event_id=None):
        reserved = self.post("/api/wristbands/reserve", {"uid": uid, "eventId": event_id})
        self.assertIn(reserved.status_code, (200, 201), reserved.json)
        wristband_id = reserved.json["wristband"]["id"]
        url = reserved.json["url"]
        confirmed = self.post(
            f"/api/wristbands/{wristband_id}/confirm", {"uid": uid, "url": url}
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.json)
        return wristband_id, url

    def token(self, url):
        return url.split("?t=")[1]

    # -- toegang ---------------------------------------------------------

    def test_admin_endpoints_require_sign_in(self):
        for method, path in [
            ("get", "/api/wristbands"),
            ("get", f"/api/wristbands/lookup?uid={UID}"),
            ("post", "/api/wristbands/reserve"),
            ("post", "/api/wristbands/x/confirm"),
            ("post", "/api/wristbands/x/activate"),
            ("post", "/api/wristbands/x/deactivate"),
            ("post", "/api/wristbands/x/failure"),
            ("delete", "/api/wristbands/x"),
            ("get", "/api/events"),
            ("post", "/api/events"),
        ]:
            response = getattr(self.client, method)(path, json={}, headers=HEADERS)
            self.assertEqual(response.status_code, 401, path)

    def test_volunteer_cannot_manage_wristbands(self):
        self.login("helper")
        self.assertEqual(self.client.get("/api/wristbands").status_code, 403)
        response = self.post("/api/wristbands/reserve", {"uid": UID})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json["error"], "FORBIDDEN")

    def test_role_change_applies_immediately(self):
        self.login()
        self.assertEqual(self.client.get("/api/wristbands").status_code, 200)
        db = connect(self.db_path)
        db.execute("UPDATE users SET role = 'volunteer' WHERE username = 'admin'")
        db.close()
        self.assertEqual(self.client.get("/api/wristbands").status_code, 403)

    def test_wrong_password_and_rate_limit(self):
        for _ in range(5):
            response = self.client.post(
                "/api/auth/login", json={"username": "admin", "password": "nope"},
                headers=HEADERS,
            )
            self.assertEqual(response.status_code, 401)
        response = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "correct horse battery"},
            headers=HEADERS,
        )
        self.assertEqual(response.status_code, 429)

    def test_csrf_header_required_for_changes(self):
        self.login()
        response = self.client.post("/api/wristbands/reserve", json={"uid": UID})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json["error"], "CSRF_HEADER_MISSING")
        response = self.client.post(
            "/api/wristbands/reserve", json={"uid": UID},
            headers={**HEADERS, "Origin": "https://evil.example"},
        )
        self.assertEqual(response.json["error"], "CROSS_ORIGIN")

    def test_me_and_logout(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.login()
        self.assertEqual(self.client.get("/api/auth/me").json["user"]["role"], "admin")
        self.post("/api/auth/logout")
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)

    # -- registratie -----------------------------------------------------

    def test_full_registration_flow(self):
        self.login()
        reserved = self.post("/api/wristbands/reserve", {"uid": "04:a3:9b:12:7c:80:91"})
        self.assertEqual(reserved.status_code, 201)
        band = reserved.json["wristband"]
        url = reserved.json["url"]
        self.assertEqual(band["label"], "WB-0001")
        self.assertEqual(band["tagUid"], UID)
        self.assertEqual(band["writeStatus"], "reserved")
        self.assertFalse(band["isActive"])
        self.assertEqual(band["registeredBy"], "admin")
        self.assertRegex(url, r"^https://linked\.example/\?t=[A-Za-z0-9_-]{22}$")
        self.assertLessEqual(len(url) - len("https://"), wristbands.MAX_URL_SUFFIX)

        # Het token zelf staat nergens in de database, alleen de hash.
        db = connect(self.db_path)
        row = db.execute("SELECT * FROM wristbands").fetchone()
        db.close()
        self.assertNotIn(self.token(url), " ".join(str(v) for v in tuple(row)))
        self.assertEqual(row["token_hash"], wristbands.hash_token(self.token(url)))

        # Nog niet bevestigd: activeren kan niet en de link werkt niet.
        response = self.post(f"/api/wristbands/{band['id']}/activate")
        self.assertEqual(response.json["error"], "NOT_VERIFIED")
        resolved = self.client.get(f"/api/wristbands/resolve?t={self.token(url)}")
        self.assertEqual(resolved.json["status"], "unknown")

        confirmed = self.post(f"/api/wristbands/{band['id']}/confirm", {"uid": UID, "url": url})
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(confirmed.json["wristband"]["writeStatus"], "verified")
        self.assertFalse(confirmed.json["alreadyConfirmed"])

        # Bevestigen is idempotent.
        again = self.post(f"/api/wristbands/{band['id']}/confirm", {"uid": UID, "url": url})
        self.assertEqual(again.status_code, 200)
        self.assertTrue(again.json["alreadyConfirmed"])

        resolved = self.client.get(f"/api/wristbands/resolve?t={self.token(url)}")
        self.assertEqual(resolved.json["status"], "inactive")

        active = self.post(f"/api/wristbands/{band['id']}/activate")
        self.assertTrue(active.json["wristband"]["isActive"])
        resolved = self.client.get(f"/api/wristbands/resolve?t={self.token(url)}")
        self.assertEqual(resolved.json["status"], "active")
        self.assertEqual(resolved.headers["Cache-Control"], "no-store")

        inactive = self.post(f"/api/wristbands/{band['id']}/deactivate")
        self.assertFalse(inactive.json["wristband"]["isActive"])
        self.assertIsNotNone(inactive.json["wristband"]["deactivatedAt"])
        resolved = self.client.get(f"/api/wristbands/resolve?t={self.token(url)}")
        self.assertEqual(resolved.json["status"], "inactive")

    def test_duplicate_tag_is_rejected(self):
        self.login()
        self.register()
        response = self.post("/api/wristbands/reserve", {"uid": UID})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["error"], "DUPLICATE_TAG")
        self.assertEqual(response.json["wristband"]["label"], "WB-0001")

    def test_retry_rotates_token_and_keeps_one_record(self):
        self.login()
        first = self.post("/api/wristbands/reserve", {"uid": UID}).json
        failed = self.post(
            f"/api/wristbands/{first['wristband']['id']}/failure",
            {"stage": "write", "error": "WRITE_FAILED"},
        )
        self.assertEqual(failed.json["wristband"]["writeStatus"], "failed")
        self.assertEqual(failed.json["wristband"]["lastError"], "write:WRITE_FAILED")

        # Andere beheerder probeert opnieuw: zelfde record, nieuw token.
        other = self.app.test_client()
        self.login("admin2", client=other)
        retry = self.post("/api/wristbands/reserve", {"uid": UID}, client=other)
        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.json["retry"])
        self.assertEqual(retry.json["wristband"]["id"], first["wristband"]["id"])
        self.assertEqual(retry.json["wristband"]["writeAttempts"], 2)
        self.assertEqual(retry.json["wristband"]["registeredBy"], "admin2")
        self.assertNotEqual(retry.json["url"], first["url"])

        # De oude link (bijv. half geschreven) kan niet meer bevestigd worden.
        stale = self.post(
            f"/api/wristbands/{first['wristband']['id']}/confirm",
            {"uid": UID, "url": first["url"]},
        )
        self.assertEqual(stale.json["error"], "URL_MISMATCH")
        ok = self.post(
            f"/api/wristbands/{first['wristband']['id']}/confirm",
            {"uid": UID, "url": retry.json["url"]},
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(self.client.get("/api/wristbands").json["wristbands"]), 1)

    def test_confirm_rejects_wrong_uid_and_foreign_url(self):
        self.login()
        reserved = self.post("/api/wristbands/reserve", {"uid": UID}).json
        wid = reserved["wristband"]["id"]
        token = self.token(reserved["url"])
        cases = [
            ({"uid": OTHER_UID, "url": reserved["url"]}, "UID_MISMATCH"),
            ({"uid": UID, "url": f"https://evil.example/?t={token}"}, "URL_MISMATCH"),
            ({"uid": UID, "url": reserved["url"] + "&x=1"}, "URL_MISMATCH"),
            ({"uid": UID, "url": None}, "URL_MISMATCH"),
            ({"uid": "nope", "url": reserved["url"]}, "INVALID_UID"),
        ]
        for body, error in cases:
            response = self.post(f"/api/wristbands/{wid}/confirm", body)
            self.assertEqual(response.json["error"], error, body)

    def test_failure_after_verification_is_refused(self):
        self.login()
        wid, _url = self.register()
        response = self.post(f"/api/wristbands/{wid}/failure", {"stage": "write", "error": "X"})
        self.assertEqual(response.json["error"], "ALREADY_VERIFIED")
        bad = self.post(f"/api/wristbands/{wid}/failure", {"stage": "x", "error": "X"})
        self.assertEqual(bad.json["error"], "INVALID_STAGE")
        bad = self.post(f"/api/wristbands/{wid}/failure", {"stage": "write", "error": "<b>"})
        self.assertEqual(bad.json["error"], "INVALID_ERROR_CODE")

    def test_discard_only_unfinished_reservations(self):
        self.login()
        wid, _url = self.register()
        self.assertEqual(self.client.delete(f"/api/wristbands/{wid}", headers=HEADERS).json["error"], "ALREADY_VERIFIED")
        pending = self.post("/api/wristbands/reserve", {"uid": OTHER_UID}).json["wristband"]["id"]
        self.assertEqual(self.client.delete(f"/api/wristbands/{pending}", headers=HEADERS).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/wristbands/{pending}", headers=HEADERS).status_code, 404)

    def test_input_validation(self):
        self.login()
        for uid in (None, "", "04A39B", "04A39B127C80ZZ", 12345, "04A39B127C8091FF"):
            response = self.post("/api/wristbands/reserve", {"uid": uid})
            self.assertEqual(response.json["error"], "INVALID_UID", uid)
        response = self.post("/api/wristbands/reserve", {"uid": UID, "eventId": 99})
        self.assertEqual(response.json["error"], "INVALID_EVENT")
        response = self.client.post(
            "/api/wristbands/reserve", data="not json",
            headers={**HEADERS, "Content-Type": "application/json"},
        )
        self.assertEqual(response.json["error"], "INVALID_JSON")
        self.assertEqual(self.client.get("/api/wristbands?status=bogus").json["error"], "INVALID_FILTER")

    def test_missing_public_url_is_reported(self):
        self.app.config["PUBLIC_BASE_URL"] = ""
        self.login()
        response = self.post("/api/wristbands/reserve", {"uid": UID})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"], "PUBLIC_URL_NOT_CONFIGURED")

    def test_base_url_validation(self):
        self.assertEqual(wristbands.normalise_base_url("https://linked.example/"), BASE)
        self.assertEqual(wristbands.normalise_base_url("https://x.nl/linked"), "https://x.nl/linked")
        for url in ("http://linked.example", "https://a b", "https://x.nl/?a=1",
                    "https://user:pw@x.nl", "https://" + "a" * 120, None):
            self.assertIsNone(wristbands.normalise_base_url(url), url)

    # -- zoeken en evenementen -------------------------------------------

    def test_search_and_filters(self):
        self.login()
        event = self.post("/api/events", {"name": "Stratumseind Friday"}).json["event"]
        self.assertEqual(self.post("/api/events", {"name": "stratumseind friday"}).status_code, 409)
        active_id, _ = self.register(UID, event_id=event["id"])
        self.post(f"/api/wristbands/{active_id}/activate")
        self.post("/api/wristbands/reserve", {"uid": OTHER_UID})
        failed = self.post("/api/wristbands/reserve", {"uid": "04FFFFFFFFFF01"}).json
        self.post(f"/api/wristbands/{failed['wristband']['id']}/failure",
                  {"stage": "verify", "error": "VERIFY_MISMATCH"})

        def labels(query):
            rows = self.client.get("/api/wristbands" + query).json["wristbands"]
            return [row["label"] for row in rows]

        self.assertEqual(labels(""), ["WB-0003", "WB-0002", "WB-0001"])
        self.assertEqual(labels("?status=active"), ["WB-0001"])
        self.assertEqual(labels("?status=pending"), ["WB-0002"])
        self.assertEqual(labels("?status=failed"), ["WB-0003"])
        self.assertEqual(labels("?status=inactive"), [])
        self.assertEqual(labels("?q=wb-0002"), ["WB-0002"])
        self.assertEqual(labels("?q=WB-3"), ["WB-0003"])
        self.assertEqual(labels("?q=a39b"), ["WB-0001"])
        self.assertEqual(labels("?q=stratum"), ["WB-0001"])
        self.assertEqual(labels(f"?eventId={event['id']}"), ["WB-0001"])
        self.assertEqual(labels("?q=%25"), [])

        found = self.client.get(f"/api/wristbands/lookup?uid={UID}").json["wristband"]
        self.assertEqual(found["eventName"], "Stratumseind Friday")
        self.assertIsNone(self.client.get("/api/wristbands/lookup?uid=04000000000000").json["wristband"])

    # -- openbare controle ------------------------------------------------

    def test_resolve_never_leaks_details(self):
        self.login()
        wid, url = self.register()
        self.post(f"/api/wristbands/{wid}/activate")
        public = self.app.test_client()
        body = public.get(f"/api/wristbands/resolve?t={self.token(url)}").json
        self.assertEqual(set(body), {"ok", "status", "eventName"})
        for token in ("", "short", "a" * 22, "../../etc/passwd", self.token(url) + "x"):
            body = public.get(f"/api/wristbands/resolve?t={token}").json
            self.assertEqual(body["status"], "unknown", token)

    # -- database en statische bestanden ---------------------------------

    def test_database_constraints(self):
        db = connect(self.db_path)
        values = ("00000000-0000-0000-0000-000000000000", 1, UID, "a" * 64, 1, "t", "t")
        insert = ("INSERT INTO wristbands (id, number, tag_uid, token_hash, registered_by,"
                  " registered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        db.execute(insert, values)
        for changed in (
            ("11111111-1111-1111-1111-111111111111", 2, UID, "b" * 64, 1, "t", "t"),
            ("11111111-1111-1111-1111-111111111111", 2, OTHER_UID, "a" * 64, 1, "t", "t"),
            ("11111111-1111-1111-1111-111111111111", 1, OTHER_UID, "b" * 64, 1, "t", "t"),
            ("11111111-1111-1111-1111-111111111111", 2, "04a39b127c8091", "b" * 64, 1, "t", "t"),
        ):
            with self.assertRaises(sqlite3.IntegrityError, msg=changed):
                db.execute(insert, changed)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE wristbands SET is_active = 1")
        db.close()

    def test_migrations_run_once(self):
        self.assertEqual(migrate(self.db_path), [])

    def test_static_files_only_from_webapp(self):
        def get(path):
            response = self.client.get(path)
            response.close()
            return response

        self.assertEqual(get("/").status_code, 200)
        self.assertEqual(get("/wristbands.html").status_code, 200)
        self.assertEqual(get("/index.html").headers["Referrer-Policy"], "no-referrer")
        for path in ("/server/app.py", "/nfc/bridge/bridge.py", "/.git/config",
                     "/server/instance/secret_key", "/app.test.cjs", "/README.md",
                     "/../README.md", "/missing.html"):
            self.assertEqual(get(path).status_code, 404, path)


if __name__ == "__main__":
    unittest.main()

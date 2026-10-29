"""Controles voor de brug zonder echte Arduino."""

import unittest
from unittest import mock

import bridge


class FakeSerial:
    def __init__(self, responses):
        self.responses = [f"{line}\r\n".encode("ascii") for line in responses]
        self.written = []
        self.is_open = True

    def write(self, data):
        self.written.append(data)

    def flush(self):
        pass

    def readline(self):
        return self.responses.pop(0) if self.responses else b""


class ValidateUrlTest(unittest.TestCase):
    def test_accepts_short_https_url(self):
        self.assertIsNone(bridge.validate_url("https://linked.example/?t=a7k92x4q"))

    def test_rejects_http(self):
        self.assertEqual(bridge.validate_url("http://linked.example"), "HTTPS_REQUIRED")

    def test_rejects_missing_url(self):
        self.assertEqual(bridge.validate_url(None), "HTTPS_REQUIRED")

    def test_rejects_long_url(self):
        url = "https://" + "a" * 41
        self.assertEqual(bridge.validate_url(url), "URL_TOO_LONG")

    def test_rejects_whitespace(self):
        self.assertEqual(bridge.validate_url("https://a b"), "INVALID_URL")


class SendCommandTest(unittest.TestCase):
    def test_skips_ready_line_and_stops_at_success(self):
        fake = FakeSerial(
            ["READY:LINKED_NFC", "STATUS:WAITING_FOR_TAG", "UID:04A39B127C8091",
             "SUCCESS:TAG_DETECTED", "SUCCESS:EXTRA"]
        )
        lines = bridge.send_command(fake, "SCAN", timeout=1)
        self.assertEqual(fake.written, [b"SCAN\n"])
        self.assertEqual(lines[-1], "SUCCESS:TAG_DETECTED")
        self.assertNotIn("READY:LINKED_NFC", lines)

    def test_times_out_without_answer(self):
        lines = bridge.send_command(FakeSerial([]), "PING", timeout=0.05)
        self.assertEqual(lines, [])


class ParseResponseTest(unittest.TestCase):
    def test_scan(self):
        body = bridge.parse_response(["UID:04A39B127C8091", "SUCCESS:TAG_DETECTED"])
        self.assertTrue(body["ok"])
        self.assertEqual(body["uid"], "04A39B127C8091")

    def test_read_url(self):
        body = bridge.parse_response(["SUCCESS:URL:https://linked.example/?t=abc"])
        self.assertEqual(body["url"], "https://linked.example/?t=abc")

    def test_written_url(self):
        body = bridge.parse_response(["STATUS:WRITING", "SUCCESS:WRITTEN:https://x.nl"])
        self.assertEqual(body["url"], "https://x.nl")

    def test_error(self):
        body = bridge.parse_response(["STATUS:WAITING_FOR_TAG", "ERROR:TAG_NOT_BLANK"])
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"], "TAG_NOT_BLANK")

    def test_timeout(self):
        self.assertEqual(bridge.parse_response([])["error"], "TIMEOUT")


class RoutesTest(unittest.TestCase):
    def setUp(self):
        self.client = bridge.app.test_client()

    def test_write_rejects_invalid_url_without_serial(self):
        with mock.patch.object(bridge, "connect_arduino") as connect:
            response = self.client.post("/api/nfc/write", json={"url": "http://x"})
        self.assertEqual(response.status_code, 400)
        connect.assert_not_called()

    def test_status_pings_arduino(self):
        fake = FakeSerial(["SUCCESS:PONG"])
        with mock.patch.object(bridge, "connect_arduino", return_value=fake):
            response = self.client.get("/api/nfc/status")
        self.assertEqual(response.get_json()["result"], "PONG")

    def test_missing_arduino_returns_503(self):
        with mock.patch.object(
            bridge, "connect_arduino", side_effect=bridge.serial.SerialException("no port")
        ):
            response = self.client.post("/api/nfc/scan")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "ARDUINO_NOT_CONNECTED")


class TapTest(unittest.TestCase):
    def setUp(self):
        bridge.taps.clear()
        bridge.tap_state.update(
            next_id=1, last_uid=None, last_seen=0.0, last_poll=0.0, reader="starting"
        )
        self.client = bridge.app.test_client()

    def test_same_tag_held_counts_once(self):
        self.assertEqual(bridge.record_tap("04AA", 100.0)["id"], 1)
        self.assertIsNone(bridge.record_tap("04AA", 101.0))
        self.assertIsNone(bridge.record_tap("04AA", 103.5))
        self.assertEqual(bridge.record_tap("04AA", 107.0)["id"], 2)

    def test_other_tag_counts_immediately(self):
        bridge.record_tap("04AA", 100.0)
        self.assertEqual(bridge.record_tap("04BB", 100.5)["uid"], "04BB")

    def test_watch_once_records_scanned_tag(self):
        fake = FakeSerial(["STATUS:WAITING_FOR_TAG", "UID:04AA", "SUCCESS:TAG_DETECTED"])
        with mock.patch.object(bridge, "connect_arduino", return_value=fake):
            tap = bridge.watch_once()
        self.assertEqual(tap["uid"], "04AA")
        self.assertEqual(bridge.tap_state["reader"], "listening")

    def test_watch_once_without_tag(self):
        fake = FakeSerial(["STATUS:WAITING_FOR_TAG", "ERROR:TAG_NOT_FOUND"])
        with mock.patch.object(bridge, "connect_arduino", return_value=fake):
            self.assertIsNone(bridge.watch_once())
        self.assertEqual(len(bridge.taps), 0)

    def test_watch_once_reports_busy_port(self):
        with mock.patch.object(
            bridge, "connect_arduino", side_effect=bridge.serial.SerialException("busy")
        ):
            self.assertIsNone(bridge.watch_once())
        self.assertEqual(bridge.tap_state["reader"], "disconnected")

    def test_first_poll_skips_old_taps(self):
        bridge.record_tap("04AA", 100.0)
        body = self.client.get("/api/nfc/taps").get_json()
        self.assertEqual(body["taps"], [])
        self.assertEqual(body["latest"], 1)
        self.assertGreater(bridge.tap_state["last_poll"], 0)

    def test_poll_returns_new_taps(self):
        bridge.record_tap("04AA", 100.0)
        bridge.record_tap("04BB", 100.5)
        body = self.client.get("/api/nfc/taps?after=1").get_json()
        self.assertEqual([tap["uid"] for tap in body["taps"]], ["04BB"])


if __name__ == "__main__":
    unittest.main()

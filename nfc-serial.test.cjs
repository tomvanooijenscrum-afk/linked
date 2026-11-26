// Tests voor nfc-serial.js met een nagebootste Web Serial-poort en firmware.
// Draaien: node nfc-serial.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "nfc-serial.js"), "utf8"));
const { LinkedNfcSerial } = globalThis;

const UID = "04A39B127C8091";
const URL = "https://linked.example/?t=AbCdEfGhIjKlMnOpQrStUv";
const fast = { ready: 60, PING: 80, VERSION: 80, SCAN: 80, INFO: 80, READ: 80, WRITE: 80 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Nagebootste firmware v2: antwoordt per regel, in kleine stukjes.
function createFirmware({ ready = "READY:LINKED_NFC:2", version = "2" } = {}) {
  const firmware = {
    ready,
    // Firmware v1 had geen CMD:-echo.
    echo: Boolean(version),
    tag: { uid: UID, url: null },
    received: [],
    overrides: {},
    buffer: "",
    emit: null,
    receive(text) {
      firmware.buffer += text;
      const lines = firmware.buffer.split("\n");
      firmware.buffer = lines.pop();
      for (const command of lines) {
        firmware.received.push(command);
        const name = command.split(":")[0];
        const override = firmware.overrides[name];
        const answer = override ? override(command) : firmware.answer(command);
        if (answer) firmware.emit([...(firmware.echo ? [`CMD:${name}`] : []), ...answer].map((line) => `${line}\r\n`).join(""));
      }
    },
    answer(command) {
      const tag = firmware.tag;
      if (command === "PING") return ["SUCCESS:PONG"];
      if (command === "VERSION") {
        return version ? [`SUCCESS:VERSION:LINKED_NFC:${version}`] : ["ERROR:UNKNOWN_COMMAND"];
      }
      const wait = "STATUS:WAITING_FOR_TAG";
      if (!tag) return [wait, "ERROR:TAG_NOT_FOUND"];
      if (command === "SCAN") return [wait, `UID:${tag.uid}`, "SUCCESS:TAG_DETECTED"];
      if (command === "INFO") {
        const content = tag.url ? ["NDEF:URL", `URL:${tag.url}`] : ["NDEF:BLANK"];
        return [wait, `UID:${tag.uid}`, "TYPE:NTAG213", "LOCKED:0", ...content, "SUCCESS:INFO"];
      }
      if (command === "READ") {
        return tag.url
          ? [wait, `UID:${tag.uid}`, `SUCCESS:URL:${tag.url}`]
          : [wait, "ERROR:NO_SUPPORTED_NDEF_URL"];
      }
      const write = command.match(/^WRITE:([0-9A-F]{14}):(BLANK|REPLACE):(.+)$/);
      if (write) {
        if (write[1] !== tag.uid) return [wait, `UID:${tag.uid}`, "ERROR:UID_MISMATCH"];
        if (tag.url && tag.url !== write[3] && write[2] === "BLANK") {
          return [wait, `UID:${tag.uid}`, "ERROR:TAG_NOT_BLANK"];
        }
        tag.url = write[3];
        return [wait, `UID:${tag.uid}`, "STATUS:WRITING", "STATUS:VERIFYING",
          `SUCCESS:WRITTEN:${tag.url}`];
      }
      return ["ERROR:UNKNOWN_COMMAND"];
    },
  };
  return firmware;
}

function createSerial(firmware, { requestError, openError } = {}) {
  const encoder = new TextEncoder();
  const listeners = {};
  let controller = null;
  const port = {
    readable: null,
    writable: null,
    opened: 0,
    closed: 0,
    async open(options) {
      assert.equal(options.baudRate, 115200);
      if (openError) throw openError;
      port.opened += 1;
      port.readable = new ReadableStream({ start: (c) => { controller = c; } });
      port.writable = new WritableStream({
        write: (chunk) => firmware.receive(new TextDecoder().decode(chunk)),
      });
      // De Uno herstart bij openen en meldt zich daarna.
      if (firmware.ready) setTimeout(() => firmware.emit(`${firmware.ready}\r\n`), 5);
    },
    async close() {
      port.closed += 1;
    },
  };
  firmware.emit = (text) => {
    // In stukjes van 5 bytes: regels komen verspreid binnen.
    const bytes = encoder.encode(text);
    for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
  };
  return {
    port,
    serial: {
      async requestPort() {
        if (requestError) throw requestError;
        return port;
      },
      addEventListener(name, callback) {
        listeners[name] = callback;
      },
    },
    unplug() {
      port.readable = null;
      listeners.disconnect?.({ target: port });
      controller.error(new DOMException("The device has been lost.", "NetworkError"));
    },
  };
}

function setup(options = {}) {
  const firmware = createFirmware(options);
  const fake = createSerial(firmware, options);
  const events = [];
  const reader = LinkedNfcSerial.createReader({
    serial: fake.serial,
    secure: true,
    timeouts: fast,
    onEvent: (event) => events.push(event),
  });
  return { firmware, fake, reader, events };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("parseResponse", () => {
  const parse = LinkedNfcSerial.parseResponse;
  assert.deepEqual(
    { ...parse(["STATUS:WAITING_FOR_TAG", `UID:${UID}`, `SUCCESS:URL:${URL}`]), lines: [] },
    { ok: true, lines: [], uid: UID, result: `URL:${URL}`, url: URL },
  );
  const info = parse([`UID:${UID}`, "TYPE:NTAG213", "LOCKED:1", "NDEF:OTHER", "SUCCESS:INFO"]);
  assert.equal(info.type, "NTAG213");
  assert.equal(info.locked, true);
  assert.equal(info.ndef, "OTHER");
  assert.equal(parse(["SUCCESS:VERSION:LINKED_NFC:2"]).version, "2");
  assert.equal(parse(["ERROR:TAG_NOT_FOUND"]).error, "TAG_NOT_FOUND");
  assert.equal(parse(["STATUS:WRITING"]).error, "INCOMPLETE_RESPONSE");
  assert.equal(parse([]).error, "INCOMPLETE_RESPONSE");
});

test("unsupported browsers and insecure pages", async () => {
  assert.equal(LinkedNfcSerial.isSupported({}, true), false);
  assert.equal(LinkedNfcSerial.isSupported({ serial: {} }, false), false);
  assert.equal(LinkedNfcSerial.isSupported({ serial: {} }, true), true);
  const reader = LinkedNfcSerial.createReader({ serial: undefined, secure: true });
  assert.equal((await reader.connect()).error, "UNSUPPORTED_BROWSER");
  assert.equal((await reader.scan()).error, "NOT_CONNECTED");
});

test("permission cancelled or port busy", async () => {
  const cancelled = setup({ requestError: new DOMException("No port selected.", "NotFoundError") });
  assert.equal((await cancelled.reader.connect()).error, "NO_PORT_SELECTED");
  assert.equal(cancelled.reader.state, "disconnected");
  const denied = setup({ requestError: new DOMException("Denied.", "SecurityError") });
  assert.equal((await denied.reader.connect()).error, "PERMISSION_DENIED");
  const busy = setup({ openError: new DOMException("Failed to open.", "NetworkError") });
  assert.equal((await busy.reader.connect()).error, "PORT_BUSY");
});

test("connect waits for READY and checks version and reader", async () => {
  const { reader, firmware, events } = setup();
  const result = await reader.connect();
  assert.deepEqual(result, { ok: true, version: "2" });
  assert.deepEqual(firmware.received, ["VERSION", "PING"]);
  assert.deepEqual(events.map((e) => e.state), ["connecting", "connected"]);
  assert.equal((await reader.connect()).error, "ALREADY_CONNECTED");
});

test("missing PN532 and old firmware are reported", async () => {
  const noReader = setup({ ready: "READY:LINKED_NFC:2:NO_READER" });
  assert.equal((await noReader.reader.connect()).error, "PN532_NOT_FOUND");
  assert.equal(noReader.reader.state, "disconnected");
  assert.equal(noReader.fake.port.closed, 1);

  const old = setup({ ready: "READY:LINKED_NFC", version: null });
  assert.equal((await old.reader.connect()).error, "FIRMWARE_OUTDATED");
  assert.equal(old.fake.port.closed, 1);
});

test("connects without READY line (board did not reset)", async () => {
  const { reader } = setup({ ready: null });
  assert.equal((await reader.connect()).ok, true);
});

test("scan, info and read parse split lines and report progress", async () => {
  const { reader, firmware, events } = setup();
  await reader.connect();
  const scan = await reader.scan();
  assert.equal(scan.ok, true);
  assert.equal(scan.uid, UID);
  assert.ok(events.some((e) => e.type === "progress" && e.step === "WAITING_FOR_TAG"));

  assert.equal((await reader.info()).ndef, "BLANK");
  assert.equal((await reader.read()).error, "NO_SUPPORTED_NDEF_URL");
  firmware.tag = null;
  assert.equal((await reader.scan()).error, "TAG_NOT_FOUND");
});

test("write sends UID, mode and URL; validates before sending", async () => {
  const { reader, firmware } = setup();
  await reader.connect();
  const written = await reader.write(UID, URL);
  assert.equal(written.ok, true);
  assert.equal(written.url, URL);
  assert.equal(firmware.received.at(-1), `WRITE:${UID}:BLANK:${URL}`);
  const read = await reader.read();
  assert.equal(read.url, URL);
  assert.equal(read.uid, UID);

  const other = "https://linked.example/?t=ZZZZZZZZZZZZZZZZZZZZZZ";
  assert.equal((await reader.write(UID, other)).error, "TAG_NOT_BLANK");
  assert.equal((await reader.write(UID, other, { replace: true })).ok, true);
  assert.equal(firmware.received.at(-1), `WRITE:${UID}:REPLACE:${other}`);
  assert.equal((await reader.write("04000000000000", URL)).error, "UID_MISMATCH");

  const count = firmware.received.length;
  assert.equal((await reader.write(UID, "http://x.nl")).error, "HTTPS_REQUIRED");
  assert.equal((await reader.write(UID, "https://a b")).error, "INVALID_URL");
  assert.equal((await reader.write(UID, `https://${"a".repeat(137)}`)).error, "URL_TOO_LONG");
  assert.equal((await reader.write("04a39b", URL)).error, "INVALID_UID");
  assert.equal((await reader.send("PING\nWRITE:x")).error, "INVALID_COMMAND");
  assert.equal(firmware.received.length, count, "Nothing invalid reached the Arduino");
});

test("commands are queued one at a time", async () => {
  const { reader } = setup();
  await reader.connect();
  const [scan, ping, info] = await Promise.all([reader.scan(), reader.ping(), reader.info()]);
  assert.equal(scan.result, "TAG_DETECTED");
  assert.equal(ping.result, "PONG");
  assert.equal(info.result, "INFO");
});

test("a late answer after a timeout is never given to the next command", async () => {
  const { reader, firmware } = setup();
  await reader.connect();
  let late = null;
  firmware.overrides.SCAN = () => {
    late = () => firmware.emit(`CMD:SCAN\r\nUID:${UID}\r\nSUCCESS:TAG_DETECTED\r\n`);
    return null;
  };
  assert.equal((await reader.scan()).error, "TIMEOUT");
  late();
  const ping = await reader.ping();
  assert.equal(ping.result, "PONG");
  assert.equal(ping.uid, undefined);
  assert.equal(reader.state, "connected");
});

test("two timeouts in a row mean the reader stopped responding", async () => {
  const { reader, firmware, fake, events } = setup();
  await reader.connect();
  firmware.overrides.SCAN = () => null;
  firmware.overrides.PING = () => null;
  assert.equal((await reader.scan()).error, "TIMEOUT");
  assert.equal((await reader.ping()).error, "TIMEOUT");
  assert.equal(reader.state, "disconnected");
  assert.equal(events.at(-1).reason, "READER_NOT_RESPONDING");
  await sleep(10);
  assert.equal(fake.port.closed, 1);
});

test("unplugging during a command", async () => {
  const { reader, firmware, fake, events } = setup();
  await reader.connect();
  firmware.overrides.WRITE = () => {
    setTimeout(() => fake.unplug(), 5);
    return ["STATUS:WAITING_FOR_TAG"];
  };
  const result = await reader.write(UID, URL);
  assert.equal(result.error, "READER_DISCONNECTED");
  assert.equal(reader.state, "disconnected");
  assert.equal(events.at(-1).reason, "READER_DISCONNECTED");
  assert.equal((await reader.scan()).error, "NOT_CONNECTED");
});

test("Arduino reset during a command", async () => {
  const { reader, firmware } = setup();
  await reader.connect();
  firmware.overrides.WRITE = () => ["STATUS:WAITING_FOR_TAG", "READY:LINKED_NFC:2"];
  assert.equal((await reader.write(UID, URL)).error, "READER_RESET");
  assert.equal((await reader.ping()).ok, true);
});

test("overlong and unsolicited lines are ignored", async () => {
  const { reader, firmware } = setup();
  await reader.connect();
  firmware.emit(`ERROR:INCOMPLETE_COMMAND\r\n${"x".repeat(2000)}\r\n`);
  firmware.overrides.PING = () => [`STATUS:${"y".repeat(600)}`, "SUCCESS:PONG"];
  const ping = await reader.ping();
  assert.equal(ping.result, "PONG");
  assert.deepEqual(ping.lines, ["SUCCESS:PONG"]);
});

test("disconnect closes the port and can reconnect", async () => {
  const { reader, fake } = setup();
  await reader.connect();
  assert.deepEqual(await reader.disconnect(), { ok: true });
  assert.equal(reader.state, "disconnected");
  assert.equal(fake.port.closed, 1);
  assert.equal((await reader.connect()).ok, true);
  assert.equal(fake.port.opened, 2);
});

(async () => {
  for (const { name, run } of tests) {
    try {
      await run();
    } catch (error) {
      console.error(`FAIL: ${name}`);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`Passed ${tests.length} Web Serial checks: ${tests.map((t) => t.name).join("; ")}.`);
})();

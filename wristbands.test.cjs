// Tests voor de beheerpagina NFC-polsbanden (wristbands.html/js).
// De lezer en de server zijn nagebootst; nfc-serial.test.cjs en
// server/test_server.py testen die afzonderlijk.
// Draaien: node wristbands.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "wristbands.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "wristbands.html"), "utf8");

const UID = "04A39B127C8091";
const OTHER_UID = "04B1C2D3E4F501";

function createElement(tagName = "div") {
  return {
    tagName,
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    focused: false,
    className: "",
    type: "",
    dataset: {},
    children: [],
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    focus() {
      this.focused = true;
    },
  };
}

// ---- Nagebootste server met dezelfde regels als server/wristbands.py ----

function createBackend() {
  const state = {
    user: null,
    users: { admin: "admin", helper: "volunteer" },
    bands: [],
    events: [{ id: 1, name: "Stratumseind" }],
    calls: [],
    fail: {},
    tokens: 0,
  };
  const ok = (data = {}, httpStatus = 200) => ({ ok: true, httpStatus, ...data });
  const err = (error, httpStatus = 409, extra = {}) => ({ ok: false, httpStatus, error, ...extra });
  const statusOf = (b) =>
    b.writeStatus === "verified" ? (b.isActive ? "active" : "inactive")
      : b.writeStatus === "reserved" ? "pending" : "failed";
  const guard = () => {
    if (!state.user) return err("NOT_SIGNED_IN", 401);
    if (state.users[state.user] !== "admin") return err("FORBIDDEN", 403);
    return null;
  };
  const find = (id) => state.bands.find((b) => b.id === id);
  const copy = (b) => (b ? { ...b } : null);

  const handlers = {
    me: () => state.user
      ? ok({ user: { username: state.user, role: state.users[state.user] } })
      : err("NOT_SIGNED_IN", 401),
    login: (username, password) => {
      if (password !== "pw" || !state.users[username]) return err("INVALID_CREDENTIALS", 401);
      state.user = username;
      return ok({ user: { username, role: state.users[username] } });
    },
    logout: () => {
      state.user = null;
      return ok();
    },
    listEvents: () => guard() ?? ok({ events: state.events }),
    createEvent: (name) => {
      if (guard()) return guard();
      if (state.events.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
        return err("DUPLICATE_EVENT");
      }
      const event = { id: state.events.length + 1, name };
      state.events.push(event);
      return ok({ event }, 201);
    },
    listWristbands: ({ q, status }) => {
      if (guard()) return guard();
      const rows = state.bands
        .filter((b) => status === "all" || statusOf(b) === status)
        .filter((b) => !q || b.label.includes(q) || b.tagUid.includes(q))
        .reverse();
      return ok({ wristbands: rows.map(copy) });
    },
    lookup: (uid) => guard() ?? ok({ wristband: copy(state.bands.find((b) => b.tagUid === uid)) }),
    reserve: (uid, eventId) => {
      if (guard()) return guard();
      let band = state.bands.find((b) => b.tagUid === uid);
      if (band?.writeStatus === "verified") return err("DUPLICATE_TAG", 409, { wristband: copy(band) });
      state.tokens += 1;
      const url = `https://linked.example/?t=token${String(state.tokens).padStart(17, "0")}`;
      const retry = Boolean(band);
      if (band) {
        band.writeAttempts += 1;
        band.writeStatus = "reserved";
      } else {
        const number = state.bands.length + 1;
        band = {
          id: `id-${number}`, label: `WB-${String(number).padStart(4, "0")}`, tagUid: uid,
          eventId, eventName: state.events.find((e) => e.id === eventId)?.name ?? null,
          writeStatus: "reserved", isActive: false, writeAttempts: 1, lastError: null,
          registeredBy: state.user, registeredAt: "2026-11-24T20:00:00+00:00",
        };
        state.bands.push(band);
      }
      band.url = url;
      return ok({ wristband: copy(band), url, retry }, retry ? 200 : 201);
    },
    reportFailure: (id, stage, error) => {
      if (guard()) return guard();
      const band = find(id);
      band.writeStatus = "failed";
      band.lastError = `${stage}:${error}`;
      return ok({ wristband: copy(band) });
    },
    confirm: (id, uid, url) => {
      if (guard()) return guard();
      const band = find(id);
      if (band.tagUid !== uid) return err("UID_MISMATCH");
      if (band.url !== url) return err("URL_MISMATCH");
      const already = band.writeStatus === "verified";
      band.writeStatus = "verified";
      band.lastError = null;
      return ok({ wristband: copy(band), alreadyConfirmed: already });
    },
    activate: (id) => {
      if (guard()) return guard();
      const band = find(id);
      if (band.writeStatus !== "verified") return err("NOT_VERIFIED");
      band.isActive = true;
      return ok({ wristband: copy(band) });
    },
    deactivate: (id) => {
      if (guard()) return guard();
      find(id).isActive = false;
      return ok({ wristband: copy(find(id)) });
    },
    discard: (id) => {
      if (guard()) return guard();
      state.bands = state.bands.filter((b) => b.id !== id);
      return ok();
    },
  };

  const api = {};
  for (const [name, handler] of Object.entries(handlers)) {
    api[name] = async (...args) => {
      state.calls.push(name);
      const failure = state.fail[name];
      if (failure) {
        delete state.fail[name];
        return failure;
      }
      return handler(...args);
    };
  }
  return { api, state };
}

// ---- Nagebootste lezer ---------------------------------------------------

function createFakeReader() {
  const reader = {
    state: "disconnected",
    calls: [],
    onEvent: null,
    tag: { uid: UID, url: null },
    next: {},
    connectResult: { ok: true, version: "2" },
    take(name) {
      const queue = reader.next[name];
      return queue && queue.length ? queue.shift() : null;
    },
    async connect() {
      reader.calls.push(["connect"]);
      if (!reader.connectResult.ok) return reader.connectResult;
      reader.state = "connected";
      reader.onEvent({ type: "state", state: "connected" });
      return reader.connectResult;
    },
    async disconnect() {
      reader.calls.push(["disconnect"]);
      reader.state = "disconnected";
      reader.onEvent({ type: "state", state: "disconnected" });
      return { ok: true };
    },
    async scan() {
      reader.calls.push(["scan"]);
      return reader.take("scan") ?? { ok: true, uid: reader.tag.uid };
    },
    async info() {
      reader.calls.push(["info"]);
      return reader.take("info") ?? {
        ok: true, uid: reader.tag.uid, type: "NTAG213", locked: false,
        ndef: reader.tag.url ? "URL" : "BLANK", url: reader.tag.url ?? undefined,
      };
    },
    async read() {
      reader.calls.push(["read"]);
      return reader.take("read") ?? (reader.tag.url
        ? { ok: true, uid: reader.tag.uid, url: reader.tag.url }
        : { ok: false, error: "NO_SUPPORTED_NDEF_URL" });
    },
    async write(uid, url, { replace = false } = {}) {
      reader.calls.push(["write", uid, url, replace]);
      const override = reader.take("write");
      if (override) return override;
      if (uid !== reader.tag.uid) return { ok: false, error: "UID_MISMATCH" };
      if (reader.tag.url && reader.tag.url !== url && !replace) {
        return { ok: false, error: "TAG_NOT_BLANK" };
      }
      reader.tag.url = url;
      return { ok: true, url };
    },
  };
  return reader;
}

// ---- Pagina opzetten -----------------------------------------------------

async function setup({ supported = true, backend = createBackend(), user } = {}) {
  const elements = new Map();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  for (const id of ids) elements.set(`#${id}`, createElement());
  // De stappenlijst met de zes stappen uit de HTML.
  const steps = [...html.matchAll(/<li data-step="([a-z]+)"/g)].map((m) => {
    const item = createElement("li");
    item.dataset.step = m[1];
    return item;
  });
  elements.get("#step-list").children = steps;
  // Zoals in een browser: een select begint op de eerste optie.
  elements.get("#status-filter").value = "all";

  if (user) backend.state.user = user;
  const reader = createFakeReader();
  const timers = [];
  const context = vm.createContext({
    console: { error() {} },
    Intl,
    Date,
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Unknown element: ${selector}`);
        return elements.get(selector);
      },
      createElement,
    },
    LinkedNfcSerial: {
      isSupported: () => supported,
      createReader({ onEvent }) {
        reader.onEvent = onEvent;
        return reader;
      },
    },
    LinkedWristbandApi: { createApi: () => backend.api },
  });
  vm.runInContext(source, context);
  await settle();

  const get = (id) => elements.get(`#${id}`);
  const page = {
    get,
    reader,
    backend,
    timers,
    async click(id) {
      await get(id).listeners.click();
      await settle();
    },
    async submit(id) {
      await get(id).listeners.submit({ preventDefault() {} });
      await settle();
    },
    async change(id, value) {
      get(id).value = value;
      await get(id).listeners.change?.();
      await settle();
    },
    stepStates: () => Object.fromEntries(steps.map((s) => [s.dataset.step, s.dataset.state])),
    rows: () => get("wristband-list").children.map((item) => item.children[0].children[0].textContent),
    rowButton: (index) => get("wristband-list").children[index].children[1],
    registrationText: () => get("registration-message").textContent,
  };
  return page;
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function signedIn(options = {}) {
  const page = await setup({ ...options, user: "admin" });
  await page.click("connect-reader");
  return page;
}

// ---- Tests -----------------------------------------------------------------

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("sign-in gate and role check", async () => {
  const page = await setup();
  assert.equal(page.get("signin-card").hidden, false);
  assert.equal(page.get("admin-area").hidden, true);

  page.get("signin-username").value = "admin";
  page.get("signin-password").value = "wrong";
  await page.submit("signin-form");
  assert.equal(page.get("signin-error").hidden, false);
  assert.match(page.get("signin-error").textContent, /Wrong username or password/);
  assert.equal(page.get("signin-password").value, "", "Password field is cleared");

  page.get("signin-username").value = "helper";
  page.get("signin-password").value = "pw";
  await page.submit("signin-form");
  assert.equal(page.get("admin-area").hidden, true, "Volunteers do not see admin tools");
  assert.match(page.get("page-message").textContent, /Only administrators/);

  const admin = await setup();
  admin.get("signin-username").value = "admin";
  admin.get("signin-password").value = "pw";
  await admin.submit("signin-form");
  assert.equal(admin.get("admin-area").hidden, false);
  assert.equal(admin.get("signin-card").hidden, true);
  assert.equal(admin.get("signed-in-as").textContent, "admin · admin");
  assert.equal(admin.get("event-select").children.length, 2);

  await admin.click("sign-out");
  assert.equal(admin.get("admin-area").hidden, true);
  assert.equal(admin.backend.state.user, null);
});

test("unsupported browser and reader connection", async () => {
  const unsupported = await setup({ supported: false, user: "admin" });
  assert.equal(unsupported.get("unsupported-note").hidden, false);
  assert.equal(unsupported.get("connect-reader").disabled, true);
  assert.equal(unsupported.get("register-button").disabled, true);

  const page = await setup({ user: "admin" });
  assert.equal(page.get("register-button").disabled, true, "Needs a reader first");
  page.reader.connectResult = { ok: false, error: "PORT_BUSY" };
  await page.click("connect-reader");
  assert.match(page.get("reader-message").textContent, /Serial Monitor/);
  assert.equal(page.get("reader-state").dataset.state, "disconnected");

  page.reader.connectResult = { ok: true };
  await page.click("connect-reader");
  assert.equal(page.get("reader-state").dataset.state, "connected");
  assert.equal(page.get("reader-state").textContent, "Connected");
  assert.equal(page.get("connect-reader").hidden, true);
  assert.equal(page.get("disconnect-reader").hidden, false);
  assert.equal(page.get("register-button").disabled, false);

  // Losgekoppelde lezer: duidelijke melding en knoppen uit.
  page.reader.onEvent({ type: "state", state: "disconnected", reason: "READER_DISCONNECTED" });
  await settle();
  assert.match(page.get("reader-message").textContent, /USB cable/);
  assert.equal(page.get("scan-tag").disabled, true);
});

test("scan and identify a tag", async () => {
  const page = await signedIn();
  page.reader.tag.url = "https://example.org/";
  await page.click("scan-tag");
  assert.equal(page.get("scan-result").hidden, false);
  assert.equal(page.get("scan-uid").textContent, UID);
  assert.equal(page.get("scan-type").textContent, "NTAG213");
  assert.equal(page.get("scan-content").textContent, "https://example.org/");
  assert.equal(page.get("scan-registration").textContent, "Not registered");

  page.reader.next.info = [{ ok: false, error: "TAG_NOT_FOUND" }];
  await page.click("scan-tag");
  assert.equal(page.get("scan-result").hidden, true);
  assert.match(page.get("reader-message").textContent, /No tag found/);

  page.reader.next.info = [{ ok: true, uid: "1A2B3C4D", type: "UNSUPPORTED" }];
  await page.click("scan-tag");
  assert.match(page.get("scan-content").textContent, /not an NTAG/);
});

test("full registration: scan, check, reserve, write, verify, confirm, activate", async () => {
  const page = await signedIn();
  page.get("event-select").value = "1";
  await page.click("register-button");

  const { calls } = page.backend.state;
  assert.deepEqual(calls.slice(-4), ["lookup", "reserve", "confirm", "listWristbands"]);
  const band = page.backend.state.bands[0];
  assert.equal(band.eventName, "Stratumseind");
  assert.deepEqual(page.reader.calls.slice(1).map((c) => c[0]), ["scan", "write", "read"]);
  assert.deepEqual(page.reader.calls[2], ["write", UID, band.url, false]);
  assert.equal(band.writeStatus, "verified");
  assert.deepEqual(Object.values(page.stepStates()), Array(6).fill("done"));
  assert.match(page.registrationText(), /WB-0001 is written and verified/);
  assert.equal(page.get("registration-url").textContent, band.url);
  assert.equal(page.get("activate-button").hidden, false);
  assert.equal(page.get("activate-button").focused, true);
  assert.equal(page.get("retry-button").hidden, true);
  assert.deepEqual(page.rows(), ["WB-0001 · Inactive"]);

  await page.click("activate-button");
  assert.equal(band.isActive, true);
  assert.match(page.registrationText(), /is active/);
  assert.equal(page.get("activate-button").hidden, true);
  assert.deepEqual(page.rows(), ["WB-0001 · Active"]);

  // Hetzelfde bandje opnieuw: dubbele registratie gemeld, niets geschreven.
  const writes = page.reader.calls.filter((c) => c[0] === "write").length;
  await page.click("register-button");
  assert.match(page.registrationText(), /already registered as WB-0001 \(Active\)/);
  assert.equal(page.stepStates().check, "failed");
  assert.equal(page.get("retry-button").hidden, true);
  assert.equal(page.reader.calls.filter((c) => c[0] === "write").length, writes);
  assert.equal(page.backend.state.bands.length, 1);
});

test("a tag with other data is only overwritten after confirmation", async () => {
  const page = await signedIn();
  page.reader.tag.url = "https://someone-else.example/";
  await page.click("register-button");
  assert.match(page.registrationText(), /already contains data/);
  assert.equal(page.stepStates().write, "failed");
  assert.equal(page.get("overwrite-button").hidden, false);
  assert.equal(page.backend.state.bands[0].lastError, "write:TAG_NOT_BLANK");

  await page.click("overwrite-button");
  const write = page.reader.calls.filter((c) => c[0] === "write").at(-1);
  assert.equal(write[3], true, "REPLACE mode");
  assert.equal(page.backend.state.bands[0].writeStatus, "verified");
  assert.equal(page.get("overwrite-button").hidden, true);
});

test("failed verification is recorded and retried safely", async () => {
  const page = await signedIn();
  page.reader.next.read = [{ ok: true, uid: UID, url: "https://linked.example/?t=wrong" }];
  await page.click("register-button");
  assert.match(page.registrationText(), /did not match/);
  assert.equal(page.stepStates().verify, "failed");
  const band = page.backend.state.bands[0];
  assert.equal(band.writeStatus, "failed");
  assert.equal(band.lastError, "verify:VERIFY_MISMATCH");
  assert.deepEqual(page.rows(), ["WB-0001 · Failed"]);
  const firstUrl = band.url;

  // Opnieuw: zelfde record, nieuw token, en de eigen half geschreven tag
  // mag worden overschreven.
  await page.click("retry-button");
  assert.equal(page.backend.state.bands.length, 1);
  assert.notEqual(band.url, firstUrl);
  assert.equal(band.writeAttempts, 2);
  const write = page.reader.calls.filter((c) => c[0] === "write").at(-1);
  assert.deepEqual(write, ["write", UID, band.url, true]);
  assert.equal(band.writeStatus, "verified");
});

test("a different tag during read-back or a disconnect stops the registration", async () => {
  const page = await signedIn();
  page.reader.next.read = [{ ok: true, uid: OTHER_UID, url: "x" }];
  await page.click("register-button");
  assert.match(page.registrationText(), /different tag/);
  assert.equal(page.backend.state.bands[0].lastError, "verify:UID_MISMATCH");

  page.reader.next.write = [{ ok: false, error: "READER_DISCONNECTED" }];
  await page.click("retry-button");
  assert.match(page.registrationText(), /disconnected/);
  assert.equal(page.backend.state.bands[0].lastError, "write:READER_DISCONNECTED");

  page.reader.next.scan = [{ ok: false, error: "TAG_NOT_FOUND" }];
  await page.click("retry-button");
  assert.equal(page.stepStates().scan, "failed");
  assert.match(page.registrationText(), /No tag found/);
});

test("server failure at confirm retries only the confirmation", async () => {
  const page = await signedIn();
  page.backend.state.fail.confirm = { ok: false, httpStatus: 0, error: "SERVER_OFFLINE" };
  await page.click("register-button");
  assert.equal(page.stepStates().confirm, "failed");
  assert.match(page.registrationText(), /Linked server/);
  const readerCalls = page.reader.calls.length;

  await page.click("retry-button");
  assert.equal(page.reader.calls.length, readerCalls, "Tag is not touched again");
  assert.equal(page.backend.state.bands[0].writeStatus, "verified");
  assert.equal(page.get("activate-button").hidden, false);
});

test("expired session during registration returns to sign-in", async () => {
  const page = await signedIn();
  page.backend.state.fail.reserve = { ok: false, httpStatus: 401, error: "NOT_SIGNED_IN" };
  await page.click("register-button");
  assert.equal(page.get("signin-card").hidden, false);
  assert.equal(page.get("admin-area").hidden, true);
  assert.equal(page.get("registration").hidden, true);
  assert.match(page.get("page-message").textContent, /Sign in again/);
  assert.equal(page.reader.calls.filter((c) => c[0] === "write").length, 0);
});

test("list: activate, deactivate, discard, search and filter", async () => {
  const page = await signedIn();
  await page.click("register-button");
  await page.click("close-registration");
  assert.equal(page.get("registration").hidden, true);
  page.reader.tag = { uid: OTHER_UID, url: null };
  page.reader.next.write = [{ ok: false, error: "WRITE_FAILED" }];
  await page.click("register-button");
  assert.deepEqual(page.rows(), ["WB-0002 · Failed", "WB-0001 · Inactive"]);
  assert.equal(page.get("wristband-count").textContent, "2");

  // Inactief bandje activeren vanuit de lijst.
  assert.equal(page.rowButton(1).textContent, "Activate");
  await page.rowButton(1).listeners.click();
  await settle();
  assert.deepEqual(page.rows(), ["WB-0002 · Failed", "WB-0001 · Active"]);
  assert.match(page.get("list-message").textContent, /WB-0001 activated/);
  assert.equal(page.rowButton(1).textContent, "Deactivate");
  assert.equal(page.rowButton(1).attributes["aria-label"], "Deactivate WB-0001");
  await page.rowButton(1).listeners.click();
  await settle();
  assert.deepEqual(page.rows(), ["WB-0002 · Failed", "WB-0001 · Inactive"]);

  // Een mislukte reservering weggooien.
  assert.equal(page.rowButton(0).textContent, "Discard");
  await page.rowButton(0).listeners.click();
  await settle();
  assert.deepEqual(page.rows(), ["WB-0001 · Inactive"]);

  // Filteren en (vertraagd) zoeken.
  await page.change("status-filter", "active");
  assert.deepEqual(page.rows(), []);
  assert.equal(page.get("wristband-empty").hidden, false);
  await page.change("status-filter", "all");
  page.get("search-input").value = "WB-0009";
  page.get("search-input").listeners.input();
  assert.equal(page.timers.length, 1, "Search waits for typing to pause");
  await page.timers.pop()();
  await settle();
  assert.deepEqual(page.rows(), []);
});

test("events can be added and duplicates are reported", async () => {
  const page = await signedIn();
  page.get("event-name").value = "Dommelbrug";
  await page.submit("event-form");
  assert.equal(page.get("event-select").children.length, 3);
  assert.equal(page.get("event-select").value, "2");
  assert.equal(page.get("event-name").value, "");
  page.get("event-name").value = "stratumseind";
  await page.submit("event-form");
  assert.match(page.get("page-message").textContent, /already exists/);
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
  console.log(`Passed ${tests.length} wristband admin checks: ${tests.map((t) => t.name).join("; ")}.`);
})();

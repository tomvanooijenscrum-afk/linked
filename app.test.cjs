// Test van de hulppagina (app.js) tegen een nep-backend.
//   node app.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createFakeServer } = require("./test-fake-server.cjs");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const source = read("app.js");
const storeSource = read("request-store.js");
const apiSource = read("wristband-api.js");
const html = read("index.html");

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup({ server = createFakeServer(), storage = createStorage(), token = null } = {}) {
  const selectors = [
    "#request-button",
    "#request-button-label",
    "#cancel-button",
    "#status-title",
    "#status-description",
    "#request-map",
    "#sound-toggle",
    "#sound-toggle-label",
  ];
  const elements = new Map();
  const timers = new Map();
  const globalListeners = {};
  let nextTimer = 0;

  for (const selector of selectors) {
    assert.ok(html.includes(`id="${selector.slice(1)}"`), selector);
    elements.set(selector, {
      textContent: "",
      hidden: false,
      disabled: false,
      focused: false,
      dataset: {},
      attributes: {},
      listeners: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      },
      focus() {
        this.focused = true;
      },
    });
  }

  const phone = server.device();
  const confetti = [];
  const context = vm.createContext({
    localStorage: storage,
    fetch: phone.fetch,
    // Verwachte offline-meldingen van de API-client niet tonen.
    console: {
      error: (...args) =>
        String(args[0]).startsWith("Could not reach") || console.error(...args),
    },
    LinkedWristbandTap: { token },
    LinkedConfetti: { fire: (origin) => confetti.push(origin) },
    addEventListener(name, callback) {
      globalListeners[name] = callback;
    },
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Onbekend element: ${selector}`);
        return elements.get(selector);
      },
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 3000, "Status wordt elke 3 s opgevraagd");
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(storeSource, context);
  vm.runInContext(apiSource, context);
  vm.runInContext(source, context);

  return {
    server,
    storage,
    elements,
    timers,
    store: context.LinkedRequestStore,
    confetti,
    click(selector) {
      return elements.get(selector).listeners.click();
    },
    async runPoll() {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      await callback();
      await settle();
    },
    dispatchStorage() {
      globalListeners.storage({ key: context.LinkedRequestStore.storageKey });
    },
    title: () => elements.get("#status-title").textContent,
    label: () => elements.get("#request-button-label").textContent,
    mapStatus: () => elements.get("#request-map").dataset.status,
  };
}

const posts = (server) =>
  server.state.calls.filter((call) => call.method === "POST" && call.path === "/api/help-requests");

(async () => {
  // 1. Aanvragen: komt op de server, met geheim lokaal bewaard.
  const app = setup();
  assert.equal(app.title(), "No active request");
  assert.equal(app.elements.get("#cancel-button").hidden, true);
  const sending = app.click("#request-button");
  assert.equal(app.title(), "Sending your request…");
  assert.equal(app.mapStatus(), "sent");
  for (let click = 0; click < 10; click += 1) app.click("#request-button");
  await sending;
  await settle();
  assert.equal(posts(app.server).length, 1, "Dubbel klikken geeft één aanvraag");
  assert.equal(app.title(), "Request sent");
  assert.ok(app.elements.get("#status-description").textContent.includes("Volunteers nearby"));
  assert.equal(app.elements.get("#request-button").hidden, true);
  assert.equal(app.elements.get("#cancel-button").hidden, false);
  assert.equal(app.mapStatus(), "received");
  const saved = app.store.getRequest();
  assert.equal(saved.id, "req-1");
  assert.equal(saved.secret, "secret-req-1");
  assert.equal(posts(app.server)[0].body.token, undefined, "Zonder bandje geen token");
  assert.equal(app.timers.size, 1, "Status wordt gevolgd");

  // 2. Nog niemand: blijft wachten. Een vrijwilliger accepteert ergens anders.
  await app.runPoll();
  assert.equal(app.title(), "Request sent");
  assert.equal(app.confetti.length, 0, "Nog geen confetti zonder acceptatie");
  const statusCall = app.server.state.calls.at(-1);
  assert.equal(statusCall.path, "/api/help-requests/req-1");
  assert.equal(statusCall.headers["X-Linked-Secret"], "secret-req-1", "Geheim in header");
  assert.ok(!statusCall.path.includes("secret"), "Geheim nooit in de URL");
  app.server.state.requests[0].status = "accepted";
  app.server.state.requests[0].acceptedAt = "2026-11-26T21:00:00+00:00";
  await app.runPoll();
  assert.equal(app.title(), "A volunteer is on the way");
  assert.equal(app.confetti.length, 1, "Confetti bij acceptatie");
  assert.equal(app.confetti[0], app.elements.get("#status-title"), "Vanuit de statusmelding");
  assert.equal(app.timers.size, 0, "Na acceptatie niet meer vragen");
  assert.equal(app.store.getRequest().status, "accepted");

  // 3. Annuleren na acceptatie.
  await app.click("#cancel-button");
  assert.equal(app.title(), "Request cancelled");
  assert.equal(app.label(), "Ask for help again");
  assert.equal(app.server.state.requests[0].status, "cancelled");
  assert.equal(app.confetti.length, 1, "Geen confetti bij annuleren");
  assert.equal(app.mapStatus(), "cancelled");

  // 4. Geopend met een polsbandje: het token gaat mee.
  const tapped = setup({ token: "active-token" });
  await tapped.click("#request-button");
  assert.equal(posts(tapped.server)[0].body.token, "active-token");
  assert.equal(tapped.server.state.requests[0].source, "wristband");

  // 5. Offline: duidelijke melding, opnieuw proberen lukt.
  const offline = setup();
  offline.server.state.online = false;
  await offline.click("#request-button");
  assert.equal(offline.title(), "Your request could not be sent");
  assert.ok(offline.elements.get("#status-description").textContent.includes("112"));
  assert.equal(offline.label(), "Try again");
  assert.equal(offline.elements.get("#request-button").hidden, false);
  assert.equal(offline.store.getRequest(), null);
  offline.server.state.online = true;
  await offline.click("#request-button");
  assert.equal(offline.title(), "Request sent");

  // 6. Annuleren zonder verbinding: aanvraag blijft open en gevolgd.
  offline.server.state.online = false;
  await offline.click("#cancel-button");
  assert.equal(offline.title(), "Could not cancel yet");
  assert.equal(offline.elements.get("#cancel-button").hidden, false);
  assert.equal(offline.timers.size, 1);
  offline.server.state.online = true;
  await offline.click("#cancel-button");
  assert.equal(offline.title(), "Request cancelled");

  // 7. Herladen: de pagina haalt meteen de laatste stand op.
  const server = createFakeServer();
  const storage = createStorage();
  const first = setup({ server, storage });
  await first.click("#request-button");
  server.state.requests[0].status = "accepted";
  const reloaded = setup({ server, storage });
  assert.equal(reloaded.title(), "Request sent", "Eerst de bewaarde stand");
  await settle();
  await settle();
  assert.equal(reloaded.title(), "A volunteer is on the way");
  assert.equal(reloaded.confetti.length, 1, "Eerste keer geaccepteerd gezien: confetti");
  const again = setup({ server, storage });
  await settle();
  await settle();
  assert.equal(again.title(), "A volunteer is on the way");
  assert.equal(again.confetti.length, 0, "Al geaccepteerd bewaard: niet opnieuw");

  // 8. Aanvraag verdwenen op de server (opgeruimd): terug naar begin.
  server.state.requests = [];
  const gone = setup({ server, storage: (() => {
    const s = createStorage();
    s.setItem("linked.help-request.v2", JSON.stringify({ id: "req-9", secret: "x", status: "pending" }));
    return s;
  })() });
  await settle();
  await settle();
  assert.equal(gone.title(), "No active request");
  assert.equal(gone.store.getRequest(), null);

  // 9. Ander tabblad op hetzelfde apparaat wijzigt de aanvraag.
  const tabs = setup();
  await tabs.click("#request-button");
  tabs.store.saveRequest({ id: "req-1", status: "cancelled" }, "secret-req-1");
  tabs.dispatchStorage();
  assert.equal(tabs.title(), "Request cancelled");
  assert.equal(tabs.timers.size, 0);

  // 10. Beschadigde opslag: gewoon opnieuw beginnen.
  const broken = createStorage();
  broken.setItem("linked.help-request.v2", "{kapot");
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  const recovered = setup({ storage: broken });
  console.error = originalError;
  assert.equal(recovered.title(), "No active request");
  assert.equal(errors.length, 1);

  console.log(
    "Passed: request goes to the server, double clicks, status polling with the " +
      "secret in a header, accepted elsewhere with confetti once, cancel, wristband token, offline and " +
      "retry, cancel offline, reload, removed on server, other tab, broken storage.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

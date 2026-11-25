// Test van de vrijwilligerspagina (volunteer.js) met meerdere apparaten
// tegen één gedeelde nep-backend.
//   node volunteer.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createFakeServer } = require("./test-fake-server.cjs");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const source = read("volunteer.js");
const storeSource = read("request-store.js");
const apiSource = read("wristband-api.js");
const geoSource = read("geo.js");
const mapSource = read("request-map.js");
const html = read("volunteer.html");

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function createElement() {
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    focused: false,
    value: "",
    className: "",
    dataset: {},
    attributes: {},
    listeners: {},
    children: [],
    setAttribute(name, value) {
      this.attributes[name] = value;
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

// Nep-Leaflet: onthoudt alleen de punten op de kaart.
function createLeaflet() {
  const markers = [];
  const chain = (target) => {
    target.addTo = () => target;
    target.bindTooltip = (text) => {
      target.tooltip = text;
      return target;
    };
    return target;
  };
  return {
    markers,
    map: () => ({ setView() {}, invalidateSize() {}, fitBounds() {} }),
    tileLayer: () => chain({}),
    layerGroup: () => chain({ clearLayers: () => (markers.length = 1) }),
    circleMarker(position, options) {
      const marker = chain({ position, options });
      markers.push(marker);
      return marker;
    },
  };
}

const ids = [
  "page-message", "signed-in-as", "sign-out", "signin-card", "signin-form",
  "signin-username", "signin-password", "signin-error", "signin-submit",
  "volunteer-area", "availability-card", "availability-toggle", "availability-value",
  "availability-hint", "nearby-status", "requests-map", "tap-request-list",
  "clear-tap-requests", "tap-alert", "tap-alert-text", "dismiss-tap-alert",
  "reader-status",
];

// Eén browser op één apparaat.
async function openPage(server, { hostname = "linked-mu-jet.vercel.app", bridge = null } = {}) {
  const elements = new Map();
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `volunteer.html mist #${id}`);
    const element = createElement();
    element.hidden = ["signin-card", "volunteer-area", "tap-alert", "page-message"].includes(id);
    elements.set(id, element);
  }

  const device = server.device();
  const bridgeCalls = [];
  async function fetch(url, init) {
    if (String(url).startsWith("http://127.0.0.1:5001")) {
      bridgeCalls.push(url);
      if (!bridge) throw new TypeError("Failed to fetch");
      return { json: async () => bridge.shift() ?? { reader: "listening", taps: [], latest: 9 } };
    }
    return device.fetch(url, init);
  }

  const timers = [];
  const leaflet = createLeaflet();
  const document = {
    visibilityState: "visible",
    getElementById: (id) => {
      assert.ok(elements.has(id), `Onbekend element: #${id}`);
      return elements.get(id);
    },
    createElement,
    addEventListener() {},
  };
  const context = vm.createContext({
    localStorage: createStorage(),
    location: { hostname },
    fetch,
    L: leaflet,
    document,
    console: { error: (...args) => String(args[0]).startsWith("Could not reach") || console.error(...args) },
    Intl,
    Date,
    addEventListener() {},
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  });
  vm.runInContext(storeSource, context);
  vm.runInContext(apiSource, context);
  vm.runInContext(geoSource, context);
  vm.runInContext(mapSource, context);
  vm.runInContext(source, context);
  await context.LinkedVolunteer.ready;

  const page = {
    elements,
    leaflet,
    timers,
    bridgeCalls,
    session: device.session,
    get: (id) => elements.get(id),
    items: () => elements.get("tap-request-list").children,
    titles: () =>
      page.items().map((item) => item.children[0].children[0].textContent),
    states: () =>
      page.items().map((item) => item.children[0].children[0].children[0].textContent),
    acceptButton: (index) => page.items()[index].children[1],
    async signIn(username, password = server.PASSWORD) {
      elements.get("signin-username").value = username;
      elements.get("signin-password").value = password;
      await elements.get("signin-form").listeners.submit({ preventDefault() {} });
      await settle();
    },
    // De volgende ronde van het regelmatig opvragen.
    async poll() {
      const timer = timers.filter((t) => t.delay === 3000).at(-1);
      await timer.callback();
      await settle();
    },
    async click(id) {
      await elements.get(id).listeners.click();
      await settle();
    },
  };
  return page;
}

// Aanvrager op een eigen telefoon (zelfde API als app.js gebruikt).
async function askHelp(server, body = {}) {
  const phone = server.device();
  const response = await phone.fetch("/api/help-requests", {
    method: "POST",
    headers: { "X-Linked-Request": "1" },
    body: JSON.stringify(body),
  });
  return (await response.json()).request.id;
}

(async () => {
  const server = createFakeServer();

  // 1. Niet ingelogd: alleen het inlogformulier, geen aanvragen.
  const laptop = await openPage(server);
  assert.equal(laptop.get("signin-card").hidden, false);
  assert.equal(laptop.get("volunteer-area").hidden, true);
  assert.equal(laptop.get("reader-status").hidden, true, "Geen lezer op de gehoste site");
  assert.equal(laptop.bridgeCalls.length, 0, "Nooit naar 127.0.0.1 op de gehoste site");

  await laptop.signIn("helper", "wrong");
  assert.equal(laptop.get("signin-error").textContent, "Wrong username or password.");
  assert.equal(laptop.get("volunteer-area").hidden, true);

  await laptop.signIn("helper");
  assert.equal(laptop.get("signin-card").hidden, true);
  assert.equal(laptop.get("volunteer-area").hidden, false);
  assert.equal(laptop.get("signed-in-as").textContent, "Signed in as helper");
  assert.equal(
    laptop.get("nearby-status").textContent,
    "No requests right now. New requests appear here automatically.",
  );
  assert.equal(laptop.get("clear-tap-requests").hidden, true, "Alleen beheerders mogen leegmaken");

  // 2. Tweede vrijwilliger op een ander apparaat.
  const tablet = await openPage(server);
  await tablet.signIn("helper2");

  // 3. Iemand vraagt hulp op een telefoon: beide apparaten zien het.
  await askHelp(server);
  await askHelp(server, { token: "active-token" });
  await laptop.poll();
  await tablet.poll();
  for (const page of [laptop, tablet]) {
    // Gesorteerd op afstand: req-2 (~0,33 km) staat het dichtst bij.
    assert.deepEqual(page.titles(), ["Request 2", "Request 1"]);
    assert.deepEqual(page.states(), ["Closest", "Waiting"]);
    assert.equal(page.get("tap-alert").hidden, false, "Melding bij een nieuwe aanvraag");
    assert.ok(page.get("tap-alert-text").textContent.startsWith("Wristband WB-0001 asked for help"));
    assert.equal(page.get("nearby-status").textContent, "2 waiting. Closest: 330 m away.");
    assert.equal(page.leaflet.markers.length, 3, "Vrijwilliger + 2 aanvragen op de kaart");
  }
  // Niets veranderd: dezelfde knoppen blijven staan (focus blijft behouden).
  const before = laptop.items()[0];
  await laptop.poll();
  assert.equal(laptop.items()[0], before, "Lijst niet opnieuw opgebouwd zonder wijziging");
  const details = laptop.items()[0].children[0].children[1].textContent;
  assert.ok(details.includes("wristband WB-0001 at Glow"), details);
  assert.ok(laptop.items()[1].children[0].children[1].textContent.includes("via the Linked app"));

  // 4. Laptop accepteert; de tablet ziet dat bij de volgende ronde.
  await laptop.acceptButton(0).listeners.click();
  await settle();
  assert.equal(laptop.states().filter((s) => s === "Accepted by you").length, 1);
  assert.equal(laptop.items().find((i) => i.dataset.status === "accepted").children.length, 1,
    "Geen knop meer bij een geaccepteerde aanvraag");
  await tablet.poll();
  assert.ok(tablet.states().includes("Accepted by helper"));
  assert.equal(tablet.get("nearby-status").textContent, "1 waiting. Closest: 1.0 km away.");
  assert.equal(tablet.get("tap-alert").hidden, true, "Melding weg na acceptatie elders");

  // 5. Tablet drukt op een verouderde knop: te laat, duidelijke melding.
  await tablet.signIn("helper2");
  server.state.requests[0].status = "pending";
  await tablet.poll();
  server.state.requests[0].status = "accepted";
  server.state.requests[0].acceptedBy = "helper";
  const stale = tablet.items().find((item) => item.children[1]?.textContent === "Accept"
    && item.children[0].children[0].textContent.startsWith("Request 1"));
  await stale.children[1].listeners.click();
  await settle();
  assert.equal(tablet.get("page-message").textContent,
    "Another volunteer already accepted this request.");
  assert.equal(tablet.get("page-message").hidden, false);
  assert.ok(!tablet.states().includes("Waiting"));

  // 6. Onbeschikbaar: wachtende aanvragen verborgen, geaccepteerde zichtbaar.
  await askHelp(server);
  await tablet.poll();
  await tablet.click("availability-toggle");
  assert.equal(tablet.get("availability-value").textContent, "Unavailable");
  assert.ok(tablet.states().every((state) => state.startsWith("Accepted")));
  assert.equal(tablet.get("tap-alert").hidden, true);
  await tablet.click("availability-toggle");
  assert.ok(tablet.states().includes("Closest"));

  // 7. Aanvrager annuleert: verdwijnt overal.
  const phone = server.device();
  await phone.fetch("/api/help-requests/req-3/cancel", {
    method: "POST",
    headers: { "X-Linked-Request": "1", "X-Linked-Secret": "secret-req-3" },
  });
  await laptop.poll();
  assert.equal(laptop.items().length, 2);

  // 8. Verbinding weg: laatste lijst blijft staan met een melding.
  server.state.online = false;
  await laptop.poll();
  assert.equal(laptop.items().length, 2);
  assert.equal(laptop.get("nearby-status").textContent,
    "All requests have been accepted. Connection lost, trying again…");
  server.state.online = true;

  // 9. Uitloggen: terug naar het inlogformulier.
  const expired = await openPage(server);
  await expired.signIn("helper");
  await expired.click("sign-out");
  assert.equal(expired.get("signin-card").hidden, false);
  assert.equal(expired.get("volunteer-area").hidden, true);
  assert.equal(expired.get("sign-out").hidden, true);

  // 10. Beheerder: mag alles leegmaken.
  const admin = await openPage(server);
  await admin.signIn("admin");
  assert.equal(admin.get("clear-tap-requests").hidden, false);
  await admin.click("clear-tap-requests");
  assert.equal(admin.items().length, 0);
  assert.equal(server.state.requests.length, 0);

  // 11. Op de computer met de lezer (localhost): een tik wordt een gedeelde aanvraag.
  const desk = await openPage(server, {
    hostname: "localhost",
    bridge: [
      { reader: "listening", taps: [], latest: 4 },
      { reader: "listening", taps: [{ id: 5, uid: "04A39B127C8091" }], latest: 5 },
    ],
  });
  assert.equal(desk.get("reader-status").hidden, false);
  await desk.signIn("helper");
  assert.equal(desk.get("reader-status").textContent, "Wristband reader: listening for taps.");
  const tapTimer = desk.timers.filter((t) => t.delay === 1500).at(-1);
  await tapTimer.callback();
  await settle();
  assert.equal(server.state.requests.length, 1);
  assert.equal(server.state.requests[0].tagUid, "04A39B127C8091");
  assert.ok(desk.items()[0].children[0].children[1].textContent.includes("(reader)"));
  await laptop.poll();
  assert.equal(laptop.items().length, 1, "Tik op de lezer is op elk apparaat zichtbaar");

  // 12. Rol ingetrokken of sessie verlopen: terug naar inloggen.
  const revoked = await openPage(server);
  await revoked.signIn("helper");
  revoked.session.user = { username: "helper", role: "guest" };
  await revoked.poll();
  assert.equal(revoked.get("volunteer-area").hidden, true);
  assert.equal(revoked.get("signin-card").hidden, false);
  assert.equal(revoked.get("page-message").textContent,
    "This account cannot see help requests. Sign in as a volunteer.");
  const lapsed = await openPage(server);
  await lapsed.signIn("helper");
  lapsed.session.user = null;
  await lapsed.poll();
  assert.equal(lapsed.get("signin-card").hidden, false);

  console.log(
    "Passed: sign-in gate, two volunteers on different devices see the same " +
      "requests, alert for new requests, accept shows on every device, stale accept " +
      "refused, availability, cancel by requester, offline, sign out, admin clear, " +
      "reader taps only on localhost and shared with every device, role revoked.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

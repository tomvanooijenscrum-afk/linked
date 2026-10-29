const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "wristbands.js"), "utf8");
const storeSource = fs.readFileSync(
  path.join(__dirname, "wristband-store.js"),
  "utf8",
);
const html = fs.readFileSync(
  path.join(__dirname, "wristbands.html"),
  "utf8",
);

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createElement(tagName = "div") {
  return {
    tagName,
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    focused: false,
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

// Een nep-brug: elke opdracht geeft het volgende antwoord uit de lijst.
function createBridge(responses) {
  const calls = [];
  async function fetch(url, options) {
    calls.push({
      endpoint: url.split("/api/nfc/")[1],
      method: options.method,
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return { json: async () => next };
  }
  return { calls, fetch };
}

function setup({ storage = createStorage(), responses = [] } = {}) {
  const selectors = [
    "#bridge-status",
    "#connect-arduino",
    "#scan-tag",
    "#base-url-form",
    "#base-url",
    "#base-url-hint",
    "#save-base-url",
    "#register-wristband",
    "#current-wristband",
    "#current-url",
    "#program-wristband",
    "#wristband-list",
    "#wristband-empty",
  ];
  const elements = new Map();
  for (const selector of selectors) {
    assert.ok(html.includes(`id="${selector.slice(1)}"`), selector);
    elements.set(selector, createElement());
  }

  const bridge = createBridge(responses);
  const context = vm.createContext({
    localStorage: storage,
    crypto: globalThis.crypto,
    console: { error() {} },
    fetch: bridge.fetch,
    addEventListener() {},
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Unknown element: ${selector}`);
        return elements.get(selector);
      },
      createElement,
    },
  });
  vm.runInContext(storeSource, context);
  vm.runInContext(source, context);

  const get = (selector) => elements.get(selector);
  return {
    get,
    storage,
    bridge,
    store: context.LinkedWristbandStore,
    status: () => get("#bridge-status").textContent,
    click: (selector) => get(selector).listeners.click(),
    saveBaseUrl(value) {
      get("#base-url").value = value;
      get("#base-url-form").listeners.submit({ preventDefault() {} });
    },
  };
}

async function run() {
  // Zonder adres kan geen polsbandje worden geregistreerd.
  const empty = setup();
  assert.equal(empty.get("#register-wristband").disabled, true);
  assert.equal(empty.get("#current-wristband").hidden, true);
  assert.equal(empty.get("#wristband-empty").hidden, false);

  // Te lange of niet-HTTPS adressen worden geweigerd.
  empty.saveBaseUrl("http://linked.example");
  assert.equal(empty.store.getBaseUrl(), null);
  assert.equal(empty.get("#base-url").attributes["aria-invalid"], "true");
  empty.saveBaseUrl("https://a-very-long-development-tunnel.example.org");
  assert.equal(empty.store.getBaseUrl(), null);

  // Verbinden en scannen tonen het antwoord van de brug.
  const storage = createStorage();
  const page = setup({
    storage,
    responses: [
      { ok: true, result: "PONG" },
      { ok: true, result: "TAG_DETECTED", uid: "04A39B127C8091" },
    ],
  });
  await page.click("#connect-arduino");
  assert.equal(page.status(), "Arduino connected.");
  assert.deepEqual(page.bridge.calls[0], {
    endpoint: "status",
    method: "GET",
    body: undefined,
  });
  await page.click("#scan-tag");
  assert.equal(page.status(), "Tag detected. UID: 04A39B127C8091");

  // Registreren maakt een wachtend bandje met een korte, passende URL.
  page.saveBaseUrl("https://linked.example/");
  assert.equal(page.store.getBaseUrl(), "https://linked.example");
  assert.equal(page.get("#register-wristband").disabled, false);
  page.click("#register-wristband");
  const [pending] = page.store.getWristbands();
  assert.equal(pending.status, "pending");
  assert.match(pending.url, /^https:\/\/linked\.example\/\?t=[a-z0-9]{8}$/);
  assert.ok(page.store.isUrlFitting(pending.url));
  assert.equal(page.get("#current-wristband").hidden, false);
  assert.equal(page.get("#current-url").textContent, pending.url);
  assert.equal(page.get("#register-wristband").disabled, true);
  assert.equal(page.get("#program-wristband").focused, true);

  // Na vernieuwen is het wachtende bandje nog steeds klaar om te programmeren.
  const refreshed = setup({ storage });
  assert.equal(refreshed.get("#current-url").textContent, pending.url);

  // Een afwijkende URL bij het teruglezen activeert het bandje niet.
  const mismatch = setup({
    storage,
    responses: [
      { ok: true, result: `WRITTEN:${pending.url}`, url: pending.url },
      { ok: true, result: "URL:https://other.example", url: "https://other.example" },
    ],
  });
  await mismatch.click("#program-wristband");
  assert.equal(mismatch.store.getWristbands()[0].status, "pending");
  assert.match(mismatch.status(), /different link/);

  // Een fout bij schrijven stopt vóór het teruglezen.
  const notBlank = setup({
    storage,
    responses: [{ ok: false, error: "TAG_NOT_BLANK" }],
  });
  await notBlank.click("#program-wristband");
  assert.equal(notBlank.bridge.calls.length, 1);
  assert.match(notBlank.status(), /already contains data/);

  // Schrijven + geslaagde controle activeert het bandje met UID.
  const programmer = setup({
    storage,
    responses: [
      { ok: true, result: `WRITTEN:${pending.url}`, url: pending.url },
      {
        ok: true,
        result: `URL:${pending.url}`,
        url: pending.url,
        uid: "04A39B127C8091",
      },
    ],
  });
  await programmer.click("#program-wristband");
  assert.deepEqual(
    programmer.bridge.calls.map((call) => call.endpoint),
    ["write", "read"],
  );
  assert.deepEqual(programmer.bridge.calls[0].body, { url: pending.url });
  const active = programmer.store.getWristbands()[0];
  assert.equal(active.status, "active");
  assert.equal(active.uid, "04A39B127C8091");
  assert.ok(Number.isFinite(active.activatedAt));
  assert.equal(programmer.get("#current-wristband").hidden, true);
  assert.equal(programmer.get("#register-wristband").disabled, false);
  assert.match(programmer.status(), /verified and active/);

  // De lijst toont het bandje; deactiveren werkt één keer.
  const list = programmer.get("#wristband-list");
  assert.equal(list.children.length, 1);
  assert.equal(programmer.get("#wristband-empty").hidden, true);
  const [item] = list.children;
  const deactivateButton = item.children[1];
  assert.equal(deactivateButton.textContent, "Deactivate");
  deactivateButton.listeners.click();
  assert.equal(programmer.store.getWristbands()[0].status, "inactive");
  assert.equal(programmer.get("#wristband-list").children[0].children.length, 1);
  assert.equal(programmer.store.deactivateWristband(active.id), null);
  assert.equal(
    programmer.store.activateWristband(active.id, null, active.url),
    null,
    "An inactive wristband cannot be activated again",
  );

  // Een offline brug geeft een duidelijke melding.
  const offline = setup({ responses: [new TypeError("Failed to fetch")] });
  await offline.click("#connect-arduino");
  assert.match(offline.status(), /bridge\.py running/);
  assert.equal(offline.get("#connect-arduino").disabled, false);

  // Ongeldige opgeslagen gegevens vallen terug op een lege lijst.
  const broken = createStorage();
  broken.setItem("linked.wristbands.v1", "{not json");
  assert.equal(setup({ storage: broken }).store.getWristbands().length, 0);

  console.log(
    "Passed: base URL validation, connect, scan, register, refresh, " +
      "verify mismatch, write error, program and activate, deactivate, " +
      "offline bridge, and invalid saved data.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

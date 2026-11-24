// Tests voor het openen van Linked via een polsbandje (wristband-tap.js)
// met de echte API-client (wristband-api.js) en een nagebootste fetch.
// Draaien: node wristband-tap.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
const tapSource = read("wristband-tap.js");
const apiSource = read("wristband-api.js");
const html = read("index.html");
const appSource = read("app.js");

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

async function open(url, respond) {
  const parsed = new URL(url);
  const elements = {};
  for (const id of ["wristband-notice", "wristband-notice-title", "wristband-notice-text"]) {
    assert.ok(html.includes(`id="${id}"`), id);
    elements[`#${id}`] = { textContent: "", hidden: true, dataset: {} };
  }
  const requests = [];
  const history = [];
  const context = vm.createContext({
    console: { error() {} },
    URLSearchParams,
    location: { search: parsed.search, pathname: parsed.pathname, hash: parsed.hash },
    history: { replaceState: (_state, _title, next) => history.push(next) },
    document: { querySelector: (selector) => elements[selector] },
    async fetch(requestUrl, options) {
      requests.push({ url: requestUrl, options });
      return respond(requestUrl);
    },
  });
  vm.runInContext(apiSource, context);
  vm.runInContext(tapSource, context);
  await context.LinkedWristbandTap.ready;
  const notice = elements["#wristband-notice"];
  return {
    requests,
    history,
    hidden: notice.hidden,
    state: notice.dataset.state,
    title: elements["#wristband-notice-title"].textContent,
    text: elements["#wristband-notice-text"].textContent,
  };
}

const json = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

(async () => {
  // De pagina laadt de scripts, en het bandje hangt niet aan de hulpknop.
  assert.ok(html.includes('src="wristband-api.js"'));
  assert.ok(html.includes('src="wristband-tap.js"'));
  assert.ok(html.includes('<meta name="referrer" content="no-referrer" />'));
  assert.ok(!appSource.includes("wristband"), "app.js stays independent of wristbands");

  // Zonder token: niets opvragen, niets tonen.
  const plain = await open("https://linked.example/", json(200, {}));
  assert.equal(plain.requests.length, 0);
  assert.equal(plain.hidden, true);
  assert.equal(plain.history.length, 0);

  // Actief bandje: herkend, token uit de adresbalk gehaald.
  const active = await open(
    `https://linked.example/?t=${TOKEN}#top`,
    json(200, { ok: true, status: "active", eventName: "Stratumseind" }),
  );
  assert.equal(active.requests.length, 1);
  assert.equal(active.requests[0].url, `/api/wristbands/resolve?t=${TOKEN}`);
  assert.equal(active.requests[0].options.method, "GET");
  assert.deepEqual(active.history, ["/#top"]);
  assert.equal(active.hidden, false);
  assert.equal(active.state, "active");
  assert.equal(active.title, "Wristband recognised");
  assert.match(active.text, /for Stratumseind/);

  // Andere parameters blijven staan.
  const other = await open(
    `https://linked.example/?lang=nl&t=${TOKEN}`,
    json(200, { ok: true, status: "active", eventName: null }),
  );
  assert.deepEqual(other.history, ["/?lang=nl"]);
  assert.equal(other.text, "You opened Linked with your wristband.");

  // Inactief, onbekend, serverfout en offline: hulp blijft mogelijk.
  const inactive = await open(`https://linked.example/?t=${TOKEN}`,
    json(200, { ok: true, status: "inactive" }));
  assert.equal(inactive.state, "inactive");
  assert.match(inactive.text, /still ask for help/);

  const unknown = await open("https://linked.example/?t=bogus",
    json(200, { ok: true, status: "unknown" }));
  assert.equal(unknown.state, "unknown");

  const weird = await open(`https://linked.example/?t=${TOKEN}`,
    json(200, { ok: true, status: "<script>" }));
  assert.equal(weird.state, "unknown");

  const serverError = await open(`https://linked.example/?t=${TOKEN}`,
    async () => ({ ok: false, status: 500, json: async () => { throw new Error("html"); } }));
  assert.equal(serverError.state, "offline");
  assert.match(serverError.text, /still ask for help/);

  const offline = await open(`https://linked.example/?t=${TOKEN}`, async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(offline.state, "offline");

  console.log(
    "Passed: no token, active (with event), other query kept, inactive, " +
      "unknown, invalid status, server error, offline, token removed from URL.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

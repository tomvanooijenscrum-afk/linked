const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function setup() {
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
  let nextTimer = 0;

  for (const selector of selectors) {
    assert.ok(html.includes(`id="${selector.slice(1)}"`));
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

  const context = vm.createContext({
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Onbekend element: ${selector}`);
        return elements.get(selector);
      },
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 1500);
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(source, context);

  return {
    elements,
    timers,
    click(selector) {
      elements.get(selector).listeners.click();
    },
    runReceipt() {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
    },
    title() {
      return elements.get("#status-title").textContent;
    },
    mapStatus() {
      return elements.get("#request-map").dataset.status;
    },
  };
}

const app = setup();
assert.equal(app.title(), "No active request");
assert.equal(app.elements.get("#request-button").hidden, false);
assert.equal(app.elements.get("#cancel-button").hidden, true);
assert.equal(app.timers.size, 0);
app.click("#request-button");
assert.equal(app.title(), "Request sent (demo)");
assert.equal(app.elements.get("#request-button").disabled, true);
assert.equal(app.elements.get("#cancel-button").hidden, false);
assert.equal(app.elements.get("#cancel-button").focused, true);
for (let click = 0; click < 10; click += 1) {
  app.click("#request-button");
}
assert.equal(app.timers.size, 1, "Slechts één actief verzoek/timer");

app.runReceipt();
assert.equal(app.title(), "Receipt simulated (demo)");
assert.ok(
  app.elements.get("#status-description").textContent.includes(
    "No real responder",
  ),
);
app.click("#request-button");
assert.equal(app.timers.size, 0, "Ontvangen verzoek blijft actief");

app.click("#cancel-button");
assert.equal(app.title(), "Request cancelled");
assert.equal(app.elements.get("#request-button").hidden, false);
assert.equal(app.elements.get("#request-button").disabled, false);
assert.equal(app.elements.get("#request-button").focused, true);
assert.equal(
  app.elements.get("#request-button-label").textContent,
  "Ask for help again",
);
app.click("#request-button");
assert.equal(app.title(), "Request sent (demo)");
assert.equal(app.timers.size, 1);

const oldReceipt = app.timers.values().next().value;
app.click("#cancel-button");
assert.equal(app.timers.size, 0);
oldReceipt();
assert.equal(app.title(), "Request cancelled");
app.click("#cancel-button");
assert.equal(app.title(), "Request cancelled");
app.click("#request-button");
oldReceipt();
assert.equal(app.title(), "Request sent (demo)");
app.runReceipt();
assert.equal(app.title(), "Receipt simulated (demo)");

const mapApp = setup();
assert.equal(mapApp.mapStatus(), "idle");
mapApp.click("#request-button");
assert.equal(mapApp.mapStatus(), "sent");
mapApp.runReceipt();
assert.equal(mapApp.mapStatus(), "received");
mapApp.click("#cancel-button");
assert.equal(mapApp.mapStatus(), "cancelled");

const toggle = mapApp.elements.get("#sound-toggle");
const toggleLabel = mapApp.elements.get("#sound-toggle-label");
assert.equal(toggle.attributes["aria-pressed"], "true");
mapApp.click("#sound-toggle");
assert.equal(toggle.attributes["aria-pressed"], "false");
assert.equal(toggleLabel.textContent, "Sound off");
mapApp.click("#sound-toggle");
assert.equal(toggleLabel.textContent, "Sound on");

assert.equal(setup().title(), "No active request");
console.log(
  "Geslaagd: openen, aanvragen, dubbele klikken, demo-ontvangst, " +
    "annuleren vóór/na ontvangst, opnieuw aanvragen, oude callbacks, " +
    "kaartstatus en geluidsknop.",
);

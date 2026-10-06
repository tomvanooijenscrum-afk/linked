// Start met: node app.test.cjs
// Node simuleert de DOM en timers. De test gebruikt de echte app.js,
// maar geen echte browser, locatie, opslag of netwerkverbinding.
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
  ];
  const elements = new Map();
  const timers = new Map();
  let nextTimer = 0;

  for (const selector of selectors) {
    // Controleer ook dat de knoppen/statusvelden echt in de HTML staan.
    assert.ok(html.includes(`id="${selector.slice(1)}"`));
    elements.set(selector, {
      textContent: "",
      hidden: false,
      disabled: false,
      focused: false,
      listeners: {},
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
      // Roep de gekoppelde handler aan, zelfs bij een verborgen knop.
      // Zo testen we ook de extra bescherming binnen startRequest().
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
  };
}

// Stories 1 en 2: openen, aanvragen en herhaald klikken.
const app = setup();
assert.equal(app.title(), "Nog geen actief verzoek");
assert.equal(app.elements.get("#request-button").hidden, false);
assert.equal(app.elements.get("#cancel-button").hidden, true);
assert.equal(app.timers.size, 0);
app.click("#request-button");
assert.equal(app.title(), "Verzonden — demo");
assert.equal(app.elements.get("#request-button").disabled, true);
assert.equal(app.elements.get("#cancel-button").hidden, false);
assert.equal(app.elements.get("#cancel-button").focused, true);
for (let click = 0; click < 10; click += 1) {
  app.click("#request-button");
}
assert.equal(app.timers.size, 1, "Slechts één actief verzoek/timer");

// Story 3: verzonden is nog geen ontvangst. Ontvangst is expliciet demo.
app.runReceipt();
assert.equal(app.title(), "Ontvangst gesimuleerd — demo");
assert.ok(
  app.elements.get("#status-description").textContent.includes(
    "Geen echte hulpverlener",
  ),
);
app.click("#request-button");
assert.equal(app.timers.size, 0, "Ontvangen verzoek blijft actief");

// Story 4: annuleren na ontvangst en opnieuw aanvragen.
app.click("#cancel-button");
assert.equal(app.title(), "Verzoek geannuleerd");
assert.equal(app.elements.get("#request-button").hidden, false);
assert.equal(app.elements.get("#request-button").disabled, false);
assert.equal(app.elements.get("#request-button").focused, true);
assert.equal(
  app.elements.get("#request-button-label").textContent,
  "Opnieuw hulp aanvragen",
);
app.click("#request-button");
assert.equal(app.title(), "Verzonden — demo");
assert.equal(app.timers.size, 1);

// Annuleer ook vóór ontvangst. Zelfs een oude callback mag niet herleven.
const oldReceipt = app.timers.values().next().value;
app.click("#cancel-button");
assert.equal(app.timers.size, 0);
oldReceipt();
assert.equal(app.title(), "Verzoek geannuleerd");
app.click("#cancel-button");
assert.equal(app.title(), "Verzoek geannuleerd");
app.click("#request-button");
oldReceipt();
assert.equal(app.title(), "Verzonden — demo");
app.runReceipt();
assert.equal(app.title(), "Ontvangst gesimuleerd — demo");

// Vernieuwen begint een nieuwe lokale sessie, zonder opgeslagen verzoek.
assert.equal(setup().title(), "Nog geen actief verzoek");
console.log(
  "Geslaagd: openen, aanvragen, dubbele klikken, demo-ontvangst, " +
    "annuleren vóór/na ontvangst, opnieuw aanvragen en oude callbacks.",
);

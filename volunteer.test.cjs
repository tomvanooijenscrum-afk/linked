const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "volunteer.js"), "utf8");
const storeSource = fs.readFileSync(
  path.join(__dirname, "request-store.js"),
  "utf8",
);
const html = fs.readFileSync(
  path.join(__dirname, "volunteer.html"),
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

function loadStore(storage) {
  const context = vm.createContext({ localStorage: storage });
  vm.runInContext(storeSource, context);
  return context.LinkedRequestStore;
}

function setup(storage = createStorage()) {
  const selectors = [
    "#inbox-status",
    "#pending-request",
    "#accepted-request",
    "#empty-state",
    "#request-received",
    "#open-request",
    "#request-details",
    "#accept-request",
  ];
  const elements = new Map();
  const globalListeners = {};

  for (const selector of selectors) {
    assert.ok(html.includes(`id="${selector.slice(1)}"`));
    elements.set(selector, {
      textContent: "",
      hidden: [
        "#pending-request",
        "#accepted-request",
        "#request-details",
      ].includes(selector),
      disabled: false,
      focused: false,
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
    localStorage: storage,
    addEventListener(name, callback) {
      globalListeners[name] = callback;
    },
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Unknown element: ${selector}`);
        return elements.get(selector);
      },
    },
  });
  vm.runInContext(storeSource, context);
  vm.runInContext(source, context);

  return {
    elements,
    storage,
    store: context.LinkedRequestStore,
    click(selector) {
      elements.get(selector).listeners.click();
    },
    dispatchStorage() {
      globalListeners.storage({
        key: context.LinkedRequestStore.storageKey,
      });
    },
  };
}

const emptyInbox = setup();
assert.equal(emptyInbox.elements.get("#pending-request").hidden, true);
assert.equal(emptyInbox.elements.get("#accepted-request").hidden, true);
assert.equal(emptyInbox.elements.get("#empty-state").hidden, false);
assert.equal(
  emptyInbox.elements.get("#inbox-status").textContent,
  "No pending requests right now.",
);

const sharedStorage = createStorage();
const requesterStore = loadStore(sharedStorage);
const request = requesterStore.createRequest();
const inbox = setup(sharedStorage);
assert.equal(inbox.elements.get("#pending-request").hidden, false);
assert.equal(inbox.elements.get("#empty-state").hidden, true);
assert.match(
  inbox.elements.get("#request-received").textContent,
  /^Received /,
);

inbox.click("#open-request");
assert.equal(inbox.elements.get("#request-details").hidden, false);
assert.equal(inbox.elements.get("#accept-request").focused, true);
assert.equal(
  inbox.elements.get("#open-request").attributes["aria-expanded"],
  "true",
);

inbox.click("#accept-request");
const acceptedRequest = requesterStore.getRequest();
assert.equal(acceptedRequest.status, "accepted");
assert.ok(Number.isFinite(acceptedRequest.acceptedAt));
assert.equal(inbox.elements.get("#pending-request").hidden, true);
assert.equal(inbox.elements.get("#accepted-request").hidden, false);
assert.match(
  inbox.elements.get("#inbox-status").textContent,
  /accepted/,
);

inbox.click("#accept-request");
assert.equal(
  requesterStore.getRequest().acceptedAt,
  acceptedRequest.acceptedAt,
  "Repeated activation cannot accept an accepted request again",
);
assert.equal(requesterStore.acceptRequest(request.id), null);

const refreshedInbox = setup(sharedStorage);
assert.equal(refreshedInbox.elements.get("#accepted-request").hidden, false);
assert.equal(refreshedInbox.elements.get("#empty-state").hidden, true);

const cancelledStorage = createStorage();
const cancelledStore = loadStore(cancelledStorage);
const cancelledRequest = cancelledStore.createRequest();
cancelledStore.cancelRequest(cancelledRequest.id);
assert.equal(cancelledStore.acceptRequest(cancelledRequest.id), null);
const cancelledInbox = setup(cancelledStorage);
assert.equal(cancelledInbox.elements.get("#pending-request").hidden, true);
assert.equal(cancelledInbox.elements.get("#accepted-request").hidden, true);
assert.equal(cancelledInbox.elements.get("#empty-state").hidden, false);

const crossTabStorage = createStorage();
const crossTabStore = loadStore(crossTabStorage);
const crossTabRequest = crossTabStore.createRequest();
const waitingInbox = setup(crossTabStorage);
crossTabStore.acceptRequest(crossTabRequest.id);
waitingInbox.dispatchStorage();
assert.equal(waitingInbox.elements.get("#accepted-request").hidden, false);
assert.equal(waitingInbox.elements.get("#pending-request").hidden, true);

console.log(
  "Passed: empty inbox, pending request, open details, accept once, " +
    "accepted refresh, cancelled request rejection, and cross-tab updates.",
);

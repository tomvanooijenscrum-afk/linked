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
    "#availability-card",
    "#availability-toggle",
    "#availability-value",
    "#availability-hint",
    "#pending-request",
    "#accepted-request",
    "#empty-state",
    "#unavailable-state",
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
        "#unavailable-state",
      ].includes(selector),
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
    dispatchStorage(key = context.LinkedRequestStore.storageKey) {
      globalListeners.storage({
        key,
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

const defaultAvailability = setup();
assert.equal(
  defaultAvailability.elements.get("#availability-card").dataset.state,
  "available",
);
assert.equal(
  defaultAvailability.elements.get("#availability-value").textContent,
  "Available",
);
assert.equal(
  defaultAvailability.elements.get("#availability-toggle").attributes[
    "aria-checked"
  ],
  "true",
);

const availabilityStorage = createStorage();
const availabilityStore = loadStore(availabilityStorage);
const pendingRequest = availabilityStore.createRequest();
const availableInbox = setup(availabilityStorage);
assert.equal(availableInbox.elements.get("#pending-request").hidden, false);
assert.equal(availableInbox.elements.get("#unavailable-state").hidden, true);
assert.equal(availableInbox.store.getRequest().id, pendingRequest.id);

availableInbox.click("#availability-toggle");
assert.equal(availableInbox.store.getAvailability(), "unavailable");
assert.equal(
  availableInbox.elements.get("#availability-card").dataset.state,
  "unavailable",
);
assert.equal(
  availableInbox.elements.get("#availability-value").textContent,
  "Unavailable",
);
assert.equal(
  availableInbox.elements.get("#availability-toggle").attributes[
    "aria-checked"
  ],
  "false",
);
assert.equal(availableInbox.elements.get("#pending-request").hidden, true);
assert.equal(availableInbox.elements.get("#empty-state").hidden, true);
assert.equal(availableInbox.elements.get("#unavailable-state").hidden, false);
assert.equal(availableInbox.elements.get("#accept-request").disabled, true);
assert.match(
  availableInbox.elements.get("#inbox-status").textContent,
  /unavailable/i,
);

const unavailableStorage = createStorage();
const unavailableStore = loadStore(unavailableStorage);
unavailableStore.setAvailability("unavailable");
const unavailableInbox = setup(unavailableStorage);
const hiddenRequest = unavailableStore.createRequest();
unavailableInbox.dispatchStorage();
assert.equal(unavailableInbox.elements.get("#pending-request").hidden, true);
assert.equal(unavailableInbox.elements.get("#unavailable-state").hidden, false);

const refreshedUnavailableInbox = setup(unavailableStorage);
assert.equal(
  refreshedUnavailableInbox.store.getAvailability(),
  "unavailable",
);
assert.equal(
  refreshedUnavailableInbox.elements.get("#pending-request").hidden,
  true,
);
assert.equal(
  refreshedUnavailableInbox.store.getRequest().id,
  hiddenRequest.id,
);

unavailableInbox.click("#accept-request");
assert.equal(unavailableStore.getRequest().status, "pending");

unavailableInbox.click("#availability-toggle");
assert.equal(unavailableStore.getAvailability(), "available");
assert.equal(unavailableInbox.elements.get("#pending-request").hidden, false);
assert.equal(unavailableInbox.elements.get("#unavailable-state").hidden, true);
assert.equal(
  unavailableInbox.store.getRequest().status,
  "pending",
);

const acceptedAvailabilityStorage = createStorage();
const acceptedAvailabilityStore = loadStore(acceptedAvailabilityStorage);
const acceptedForUnavailable = acceptedAvailabilityStore.createRequest();
acceptedAvailabilityStore.acceptRequest(acceptedForUnavailable.id);
const acceptedUnavailableInbox = setup(acceptedAvailabilityStorage);
acceptedUnavailableInbox.click("#availability-toggle");
assert.equal(
  acceptedUnavailableInbox.elements.get("#accepted-request").hidden,
  false,
);
assert.equal(
  acceptedUnavailableInbox.elements.get("#unavailable-state").hidden,
  true,
);
assert.match(
  acceptedUnavailableInbox.elements.get("#inbox-status").textContent,
  /accepted/i,
);

const crossTabAvailabilityStorage = createStorage();
const crossTabAvailabilityStore = loadStore(crossTabAvailabilityStorage);
const crossTabAvailabilityInbox = setup(crossTabAvailabilityStorage);
crossTabAvailabilityStore.setAvailability("unavailable");
crossTabAvailabilityInbox.dispatchStorage(
  crossTabAvailabilityInbox.store.availabilityKey,
);
assert.equal(
  crossTabAvailabilityInbox.elements.get("#availability-card").dataset.state,
  "unavailable",
);
assert.equal(
  crossTabAvailabilityInbox.elements.get("#availability-value").textContent,
  "Unavailable",
);

const invalidAvailabilityStorage = createStorage();
invalidAvailabilityStorage.setItem(
  "linked.volunteer-availability.v1",
  "banana",
);
const invalidAvailabilityStore = loadStore(invalidAvailabilityStorage);
assert.equal(invalidAvailabilityStore.getAvailability(), "available");
assert.equal(invalidAvailabilityStore.setAvailability("banana"), null);

console.log(
  "Passed (story 8): availability default, inbox visibility, toggle, " +
    "persistence, hidden-request retention, acceptance guard, accepted " +
    "request visibility, cross-tab update, and invalid-value fallback.",
);

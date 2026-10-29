const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "volunteer.js"), "utf8");
const storeSource = fs.readFileSync(
  path.join(__dirname, "request-store.js"),
  "utf8",
);
const tapStoreSource = fs.readFileSync(
  path.join(__dirname, "tap-request-store.js"),
  "utf8",
);
const mapSource = fs.readFileSync(
  path.join(__dirname, "request-map.js"),
  "utf8",
);
const approximateMapSource = fs.readFileSync(
  path.join(__dirname, "approximate-map.js"),
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

function loadTapStore(storage) {
  const context = vm.createContext({
    localStorage: storage,
    crypto: globalThis.crypto,
  });
  vm.runInContext(tapStoreSource, context);
  return context.LinkedTapRequestStore;
}

function createElement() {
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    focused: false,
    className: "",
    src: "",
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

function createLeaflet() {
  const maps = [];
  return {
    maps,
    map(element, options) {
      const instance = {
        element,
        options,
        fittedBounds: null,
        setView(center, zoom) {
          this.initialView = { center, zoom };
        },
        invalidateSize() {},
        fitBounds(bounds, fitOptions) {
          this.fittedBounds = { bounds, options: fitOptions };
        },
        remove() {},
      };
      maps.push(instance);
      return instance;
    },
    tileLayer(url, options) {
      return {
        url,
        options,
        addTo(map) {
          map.tileLayer = this;
        },
      };
    },
    circle(center, options) {
      return {
        center,
        radius: options.radius,
        options,
        addTo(map) {
          map.circle = this;
          return this;
        },
        getBounds() {
          return { center: this.center, radius: this.radius };
        },
        setLatLng(nextCenter) {
          this.center = nextCenter;
        },
        setRadius(radius) {
          this.radius = radius;
        },
      };
    },
  };
}

function createNearbyLeaflet() {
  const markers = [];
  const chain = (target) => {
    target.addTo = () => target;
    target.bindTooltip = (text) => {
      target.tooltip = text;
      return target;
    };
    return target;
  };
  const leaflet = {
    markers,
    map: () => ({
      setView() {},
      invalidateSize() {},
      fitBounds(points) {
        leaflet.bounds = points;
      },
    }),
    tileLayer: () => chain({}),
    layerGroup: () =>
      chain({
        clearLayers() {
          markers.length = 1;
        },
      }),
    circleMarker(position, options) {
      const marker = chain({ position, options });
      markers.push(marker);
      return marker;
    },
  };
  return leaflet;
}

function loadStore(storage) {
  const context = vm.createContext({ localStorage: storage });
  vm.runInContext(storeSource, context);
  return context.LinkedRequestStore;
}

// Nep-brug: geeft de antwoorden op volgorde terug; zonder antwoord offline.
function createBridge(responses = []) {
  const urls = [];
  async function fetch(url) {
    urls.push(url);
    if (responses.length === 0) {
      throw new TypeError("Failed to fetch");
    }
    const next = responses.shift();
    return { json: async () => next };
  }
  return { urls, fetch };
}

function setup(
  storage = createStorage(),
  bridgeResponses = [],
  leaflet = undefined,
) {
  const selectors = [
    "#accepted-location",
    "#accepted-location-map",
    "#accepted-location-label",
    "#accepted-no-location",
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
    "#nearby-status",
    "#requests-map",
    "#tap-request-list",
    "#clear-tap-requests",
    "#tap-alert",
    "#tap-alert-text",
    "#dismiss-tap-alert",
    "#reader-status",
  ];
  const elements = new Map();
  const globalListeners = {};

  for (const selector of selectors) {
    assert.ok(html.includes(`id="${selector.slice(1)}"`));
    const element = createElement();
    element.hidden = [
      "#pending-request",
      "#accepted-request",
      "#request-details",
      "#unavailable-state",
      "#tap-alert",
    ].includes(selector);
    elements.set(selector, element);
  }

  const approximateLeaflet = createLeaflet();
  const bridge = createBridge(bridgeResponses);
  let pollTimer = null;
  const context = vm.createContext({
    localStorage: storage,
    crypto: globalThis.crypto,
    L: leaflet,
    fetch: bridge.fetch,
    setInterval(callback) {
      pollTimer = callback;
    },
    addEventListener(name, callback) {
      globalListeners[name] = callback;
    },
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Unknown element: ${selector}`);
        return elements.get(selector);
      },
      createElement,
    },
  });
  vm.runInContext(storeSource, context);
  vm.runInContext(tapStoreSource, context);
  vm.runInContext(mapSource, context);
  const nearbyMap = context.LinkedRequestMap;
  context.LinkedRequestMap = { update(...args) { const previous = context.L; context.L = leaflet; try { return nearbyMap.update(...args); } finally { context.L = previous; } } };
  context.L = approximateLeaflet;
  vm.runInContext(approximateMapSource, context);
  vm.runInContext(source, context);

  return {
    elements,
    leaflet: approximateLeaflet,
    storage,
    store: context.LinkedRequestStore,
    tapStore: context.LinkedTapRequestStore,
    bridge,
    items: () => elements.get("#tap-request-list").children,
    // Wacht tot de lopende vraag aan de brug klaar is.
    settle: () => new Promise((resolve) => setImmediate(resolve)),
    async poll() {
      await pollTimer();
    },
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
requesterStore.setApproximateLocation(request.id, {
  latitude: 52.123456,
  longitude: 5.987654,
  accuracy: 70,
});
requesterStore.setApproximateLocationLabel(
  request.id,
  "Near Market Street, Centrum, Eindhoven",
);
const inbox = setup(sharedStorage);
assert.equal(inbox.elements.get("#pending-request").hidden, false);
assert.equal(inbox.elements.get("#empty-state").hidden, true);
assert.match(
  inbox.elements.get("#request-received").textContent,
  /^Received /,
);

inbox.click("#open-request");
assert.equal(inbox.elements.get("#request-details").hidden, false);
assert.equal(inbox.elements.get("#accepted-request").hidden, true);
assert.equal(
  inbox.elements.get("#accepted-location").hidden,
  true,
);
assert.equal(
  inbox.leaflet.maps.length,
  0,
);
assert.equal(
  inbox.elements.get("#accepted-location-label").textContent,
  "",
);
assert.equal(
  inbox.elements.get("#accepted-no-location").hidden,
  true,
);
assert.ok(
  !inbox.elements.get("#accepted-location-map").src.includes("52.12"),
);
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
assert.equal(
  inbox.elements.get("#accepted-location-label").textContent,
  "Near Market Street, Centrum, Eindhoven",
);
assert.ok(
  !inbox.elements.get("#accepted-location-label").textContent.includes(
    "52.12",
  ),
);
assert.equal(inbox.leaflet.maps.length, 1);
assert.deepEqual(
  Array.from(inbox.leaflet.maps[0].circle.center),
  [52.12, 5.99],
);
assert.equal(inbox.leaflet.maps[0].circle.radius, 750);
assert.equal(inbox.leaflet.maps[0].fittedBounds.bounds.radius, 750);
assert.match(
  inbox.leaflet.maps[0].tileLayer.options.attribution,
  /OpenStreetMap contributors/,
);
assert.equal(inbox.elements.get("#accepted-no-location").hidden, true);
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
  acceptedUnavailableInbox.elements.get("#accepted-no-location").hidden,
  false,
);
assert.equal(
  acceptedUnavailableInbox.elements.get("#accepted-no-location").textContent,
  "No location shared.",
);
assert.equal(acceptedUnavailableInbox.leaflet.maps.length, 0);
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

async function runTapTests() {
  const listening = { ok: true, reader: "listening" };
  const tap = (id, uid = "04A39B127C8091") => ({
    ...listening,
    taps: [{ id, uid }],
    latest: id,
  });

  // Afstanden: haversine en hypothetische plekken op 0,3–3 km.
  const distanceStore = loadTapStore(createStorage());
  const volunteer = distanceStore.volunteerLocation;
  assert.equal(distanceStore.distanceMeters(volunteer, volunteer), 0);
  const oneKmNorth = {
    latitude: volunteer.latitude + 1000 / 111195,
    longitude: volunteer.longitude,
  };
  assert.ok(
    Math.abs(distanceStore.distanceMeters(volunteer, oneKmNorth) - 1000) < 2,
  );
  for (let i = 0; i < 50; i += 1) {
    const request = distanceStore.createTapRequest(`04${i}`);
    const distance = distanceStore.distanceMeters(volunteer, request.location);
    assert.ok(distance >= 299 && distance <= 3001, `distance ${distance}`);
  }
  assert.equal(distanceStore.getTapRequests().length, 20, "Keeps the last 20");
  assert.equal(distanceStore.createTapRequest(""), null);
  const sorted = distanceStore.getTapRequestsByDistance();
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i - 1].distanceMeters <= sorted[i].distanceMeters);
  }

  // Eerste vraag negeert oude tikken; elke volgende tik is een nieuw verzoek.
  const leaflet = createNearbyLeaflet();
  const tapStorage = createStorage();
  const tapInbox = setup(
    tapStorage,
    [{ ...listening, taps: [], latest: 4 }, tap(5), tap(6), tap(7, "04BB")],
    leaflet,
  );
  await tapInbox.settle();
  assert.equal(tapInbox.tapStore.getTapRequests().length, 0);
  assert.match(
    tapInbox.elements.get("#reader-status").textContent,
    /listening/,
  );
  assert.ok(tapInbox.bridge.urls[0].endsWith("/api/nfc/taps"));
  assert.equal(tapInbox.elements.get("#clear-tap-requests").hidden, true);
  assert.equal(leaflet.markers.length, 1, "Only the volunteer at first");

  await tapInbox.poll();
  assert.ok(tapInbox.bridge.urls[1].endsWith("/api/nfc/taps?after=4"));
  assert.equal(tapInbox.elements.get("#tap-alert").hidden, false);
  assert.match(
    tapInbox.elements.get("#tap-alert-text").textContent,
    /04A39B127C8091 was tapped just now, .* away/,
  );
  await tapInbox.poll();
  await tapInbox.poll();
  const requests = tapInbox.tapStore.getTapRequestsByDistance();
  assert.equal(requests.length, 3, "Every tap is a new request");
  assert.equal(
    tapInbox.store.getRequest(),
    null,
    "The requester page request is not touched",
  );

  // Lijst: dichtstbijzijnde eerst, met afstand en eigen accepteerknop.
  const items = tapInbox.items();
  assert.equal(items.length, 3);
  assert.equal(items[0].dataset.closest, "true");
  assert.equal(items[1].dataset.closest, "false");
  assert.match(items[0].children[0].children[0].children[0].textContent, /Closest/);
  assert.match(items[0].children[0].children[1].textContent, / away · wristband /);
  assert.match(
    tapInbox.elements.get("#nearby-status").textContent,
    /^3 waiting\. Closest: /,
  );

  // Kaart: vrijwilliger plus drie verzoeken; dichtstbijzijnde groter.
  assert.equal(leaflet.markers.length, 4);
  assert.equal(leaflet.markers[1].options.radius, 11);
  assert.equal(leaflet.markers[2].options.radius, 8);
  assert.equal(leaflet.bounds.length, 4);
  assert.equal(tapInbox.elements.get("#requests-map").dataset.mapState, "ready");

  // Het dichtstbijzijnde accepteren maakt het volgende het dichtstbij.
  const closestId = requests[0].id;
  items[0].children[1].listeners.click();
  assert.equal(
    tapInbox.tapStore.getTapRequests().find((r) => r.id === closestId).status,
    "accepted",
  );
  const afterAccept = tapInbox.items();
  assert.equal(afterAccept[0].dataset.closest, "true");
  assert.notEqual(afterAccept[0].children[0].children[0].textContent, "");
  const acceptedItem = afterAccept.find(
    (item) => item.children.length === 1,
  );
  assert.match(
    acceptedItem.children[0].children[0].children[0].textContent,
    /Accepted/,
  );
  assert.match(
    tapInbox.elements.get("#nearby-status").textContent,
    /^2 waiting/,
  );

  // Melding sluiten zet de focus op de status bij de kaart.
  tapInbox.click("#dismiss-tap-alert");
  assert.equal(tapInbox.elements.get("#tap-alert").hidden, true);
  assert.equal(tapInbox.elements.get("#nearby-status").focused, true);

  // Na vernieuwen staan de verzoeken er nog.
  const refreshed = setup(tapStorage);
  assert.equal(refreshed.items().length, 3);

  // Onbeschikbaar: wachtende verzoeken verborgen, geaccepteerde zichtbaar,
  // accepteren geblokkeerd en geen melding bij een nieuwe tik.
  refreshed.click("#availability-toggle");
  assert.equal(refreshed.items().length, 1);
  assert.match(
    refreshed.elements.get("#nearby-status").textContent,
    /unavailable/,
  );
  const pausedStorage = createStorage();
  loadStore(pausedStorage).setAvailability("unavailable");
  const pausedInbox = setup(pausedStorage, [
    { ...listening, taps: [], latest: 0 },
    tap(1, "04CC"),
  ]);
  await pausedInbox.settle();
  await pausedInbox.poll();
  assert.equal(pausedInbox.tapStore.getTapRequests().length, 1);
  assert.equal(pausedInbox.elements.get("#tap-alert").hidden, true);
  assert.equal(pausedInbox.items().length, 0);

  // Wissen maakt de lijst leeg.
  refreshed.click("#availability-toggle");
  refreshed.click("#clear-tap-requests");
  assert.equal(refreshed.tapStore.getTapRequests().length, 0);
  assert.equal(refreshed.items().length, 0);
  assert.match(
    refreshed.elements.get("#nearby-status").textContent,
    /No wristband requests yet/,
  );

  // Zonder Leaflet (offline) blijft de lijst werken.
  const noMapInbox = setup(tapStorage);
  assert.equal(
    noMapInbox.elements.get("#requests-map").dataset.mapState,
    "unavailable",
  );

  // Ongeldige opgeslagen gegevens vallen terug op een lege lijst.
  const brokenStorage = createStorage();
  brokenStorage.setItem("linked.tap-requests.v1", "{not json");
  assert.equal(loadTapStore(brokenStorage).getTapRequests().length, 0);

  // Brug offline en Arduino los geven een duidelijke status.
  const offlineInbox = setup();
  await offlineInbox.settle();
  assert.match(
    offlineInbox.elements.get("#reader-status").textContent,
    /bridge offline/,
  );
  const disconnectedInbox = setup(createStorage(), [
    { ok: true, reader: "disconnected", taps: [], latest: 0 },
  ]);
  await disconnectedInbox.settle();
  assert.match(
    disconnectedInbox.elements.get("#reader-status").textContent,
    /Serial Monitor/,
  );

  console.log(
    "Passed (story 7 map): distances, simulated positions, every tap a " +
      "request, closest first, map markers, accept per request, dismiss, " +
      "refresh, unavailable, clear, offline map, reader status.",
  );
}

runTapTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

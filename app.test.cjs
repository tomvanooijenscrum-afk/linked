const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const storeSource = fs.readFileSync(
  path.join(__dirname, "request-store.js"),
  "utf8",
);
const approximateMapSource = fs.readFileSync(
  path.join(__dirname, "approximate-map.js"),
  "utf8",
);
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function createLeaflet() {
  const maps = [];
  const leaflet = {
    maps,
    map(element, options) {
      const instance = {
        element,
        options,
        invalidations: 0,
        fittedBounds: null,
        removed: false,
        setView(center, zoom) {
          this.initialView = { center, zoom };
        },
        invalidateSize() {
          this.invalidations += 1;
        },
        fitBounds(bounds, fitOptions) {
          this.fitCount = (this.fitCount || 0) + 1;
          this.fittedBounds = { bounds, options: fitOptions };
        },
        remove() {
          this.removed = true;
        },
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
  return leaflet;
}

function createResizeObserverList() {
  const observers = [];
  class TestResizeObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe(element) {
      this.element = element;
    }

    disconnect() {
      this.disconnected = true;
    }
  }
  return { observers, ResizeObserver: TestResizeObserver };
}

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

function setup(storage = createStorage(), geolocation = null, geocodeFetch = null) {
  assert.ok(html.includes('src="request-store.js"'));
  assert.ok(html.includes('src="approximate-map.js"'));
  assert.ok(html.includes("leaflet@1.9.4"));
  assert.ok(!html.includes('id="request-map"'));
  const selectors = [
    "#request-button",
    "#request-button-label",
    "#cancel-button",
    "#status-title",
    "#status-description",
    "#share-location",
    "#location-choice-state",
    "#location-feedback",
    "#location-without-button",
    "#request-location-preview",
    "#request-location-map",
    "#request-location-label",
    "#sound-toggle",
    "#sound-toggle-label",
  ];
  const elements = new Map();
  const timers = new Map();
  const globalListeners = {};
  const resizeObserverList = createResizeObserverList();
  let nextTimer = 0;

  for (const selector of selectors) {
    assert.ok(html.includes(`id="${selector.slice(1)}"`));
    elements.set(selector, {
      textContent: "",
      hidden: false,
      disabled: false,
      focused: false,
      checked: false,
      dataset: {},
      attributes: {},
      src: "",
      listeners: {},
      replaceChildren() {
        this.textContent = "";
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
        if (name === "src") {
          this.src = "";
        }
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
    L: createLeaflet(),
    ResizeObserver: resizeObserverList.ResizeObserver,
    navigator: geolocation ? { geolocation } : undefined,
    fetch: geocodeFetch || undefined,
    URLSearchParams,
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
      assert.equal(delay, 1500);
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(storeSource, context);
  vm.runInContext(approximateMapSource, context);
  vm.runInContext(source, context);

  return {
    elements,
    timers,
    store: context.LinkedRequestStore,
    leaflet: context.L,
    resizeObservers: resizeObserverList.observers,
    storage,
    click(selector) {
      elements.get(selector).listeners.click();
    },
    dispatchStorage() {
      globalListeners.storage({
        key: context.LinkedRequestStore.storageKey,
      });
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

function createGeolocation() {
  const calls = [];
  return {
    calls,
    api: {
      getCurrentPosition(success, error, options) {
        calls.push({ success, error, options });
      },
    },
  };
}

const unavailableMapContext = vm.createContext({});
const unavailableMapElement = { textContent: "", dataset: {} };
vm.runInContext(approximateMapSource, unavailableMapContext);
unavailableMapContext.LinkedApproximateMap.update(unavailableMapElement, {
  latitude: 52.12,
  longitude: 5.99,
  radiusMeters: 700,
});
assert.equal(unavailableMapElement.textContent, "Map preview unavailable.");
assert.equal(unavailableMapElement.dataset.mapState, "unavailable");

const app = setup();
assert.equal(app.title(), "No active request");
assert.equal(app.elements.get("#share-location").checked, false);
assert.equal(app.elements.get("#location-without-button").hidden, true);
assert.equal(app.elements.get("#request-location-preview").hidden, true);
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
    "available to volunteers",
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

const statusFlowApp = setup();
statusFlowApp.click("#request-button");
assert.equal(statusFlowApp.title(), "Request sent (demo)");
statusFlowApp.runReceipt();
assert.equal(statusFlowApp.title(), "Receipt simulated (demo)");
statusFlowApp.click("#cancel-button");
assert.equal(statusFlowApp.title(), "Request cancelled");

const lifecycleStorage = createStorage();
const requester = setup(lifecycleStorage);
requester.click("#request-button");
const pendingRequest = requester.store.getRequest();
assert.equal(pendingRequest.status, "pending");
requester.runReceipt();
assert.equal(requester.store.acceptRequest(pendingRequest.id).status, "accepted");
assert.equal(requester.store.acceptRequest(pendingRequest.id), null);
requester.dispatchStorage();
assert.equal(requester.title(), "A volunteer is on the way");
assert.equal(requester.elements.get("#cancel-button").hidden, false);

const refreshedRequester = setup(lifecycleStorage);
assert.equal(refreshedRequester.title(), "A volunteer is on the way");
assert.equal(
  refreshedRequester.elements.get("#location-feedback").textContent,
  "No location was shared for this request.",
);

const cancelledRequester = setup();
cancelledRequester.click("#request-button");
const cancelledRequest = cancelledRequester.store.getRequest();
cancelledRequester.click("#cancel-button");
assert.equal(cancelledRequester.store.getRequest().status, "cancelled");
assert.equal(cancelledRequester.store.acceptRequest(cancelledRequest.id), null);
assert.equal(setup(cancelledRequester.storage).title(), "Request cancelled");

const toggle = statusFlowApp.elements.get("#sound-toggle");
const toggleLabel = statusFlowApp.elements.get("#sound-toggle-label");
assert.equal(toggle.attributes["aria-pressed"], "true");
statusFlowApp.click("#sound-toggle");
assert.equal(toggle.attributes["aria-pressed"], "false");
assert.equal(toggleLabel.textContent, "Sound off");
statusFlowApp.click("#sound-toggle");
assert.equal(toggleLabel.textContent, "Sound on");

assert.equal(setup().title(), "No active request");

const noLocationApp = setup();
noLocationApp.click("#request-button");
assert.equal(noLocationApp.store.getRequest().approximateLocation, null);
assert.match(
  noLocationApp.elements.get("#location-feedback").textContent,
  /sent without it/,
);

const grantedLocation = createGeolocation();
const locationApp = setup(createStorage(), grantedLocation.api);
locationApp.elements.get("#share-location").checked = true;
assert.equal(grantedLocation.calls.length, 0, "Permission waits for submit");
locationApp.click("#request-button");
assert.equal(grantedLocation.calls.length, 1);
assert.equal(grantedLocation.calls[0].options.enableHighAccuracy, false);
assert.equal(grantedLocation.calls[0].options.timeout, 10000);
assert.equal(locationApp.store.getRequest().approximateLocation, null);
grantedLocation.calls[0].success({
  coords: { latitude: 52.123456, longitude: 5.987654, accuracy: 70 },
});
assert.equal(
  locationApp.store.getRequest().approximateLocation.latitude,
  52.12,
);
assert.equal(
  locationApp.store.getRequest().approximateLocation.longitude,
  5.99,
);
assert.equal(locationApp.elements.get("#request-location-preview").hidden, false);
assert.equal(locationApp.leaflet.maps.length, 1);
assert.deepEqual(
  Array.from(locationApp.leaflet.maps[0].circle.center),
  [52.12, 5.99],
);
assert.equal(locationApp.leaflet.maps[0].circle.radius, 750);
assert.equal(locationApp.leaflet.maps[0].circle.options.fillOpacity, 0.28);
assert.equal(locationApp.leaflet.maps[0].fittedBounds.bounds.radius, 750);
assert.equal(locationApp.leaflet.maps[0].fittedBounds.options.maxZoom, 15);
assert.match(
  locationApp.leaflet.maps[0].tileLayer.options.attribution,
  /OpenStreetMap contributors/,
);
assert.equal(
  locationApp.elements.get("#request-location-map").dataset.mapState,
  "ready",
);
const mapInvalidations = locationApp.leaflet.maps[0].invalidations;
const mapFitCount = locationApp.leaflet.maps[0].fitCount;
locationApp.resizeObservers[0].callback();
assert.ok(locationApp.leaflet.maps[0].invalidations > mapInvalidations);
assert.ok(locationApp.leaflet.maps[0].fitCount > mapFitCount);
assert.equal(
  locationApp.elements.get("#request-location-label").textContent,
  "Approximate location available",
);
assert.ok(
  !locationApp.elements.get("#request-location-label").textContent.includes(
    "52.12",
  ),
);
const storedLocation = locationApp.storage.getItem(
  locationApp.store.storageKey,
);
assert.ok(!storedLocation.includes("52.123456"));
assert.ok(!storedLocation.includes("5.987654"));
assert.ok(!storedLocation.includes('"accuracy"'));
assert.equal(
  locationApp.store.getRequest().approximateLocation.radiusMeters,
  750,
);
assert.match(
  locationApp.elements.get("#location-feedback").textContent,
  /Approximate area ready/,
);
assert.equal(
  locationApp.elements.get("#location-without-button").hidden,
  true,
);
locationApp.store.acceptRequest(locationApp.store.getRequest().id);
const refreshedLocationApp = setup(locationApp.storage);
assert.match(
  refreshedLocationApp.elements.get("#location-feedback").textContent,
  /Approximate area shared with your volunteer/,
);
locationApp.click("#cancel-button");
assert.equal(locationApp.resizeObservers[0].disconnected, true);
assert.equal(
  locationApp.store.getRequest().approximateLocation,
  null,
);

const deniedLocation = createGeolocation();
const deniedApp = setup(createStorage(), deniedLocation.api);
deniedApp.elements.get("#share-location").checked = true;
deniedApp.click("#request-button");
deniedLocation.calls[0].error({ code: 1 });
assert.equal(deniedApp.store.getRequest().approximateLocation, null);
assert.equal(deniedApp.elements.get("#share-location").checked, false);
assert.match(
  deniedApp.elements.get("#location-feedback").textContent,
  /permission was denied/,
);

for (const [code, feedback] of [
  [2, /couldn’t be found/],
  [3, /timed out/],
]) {
  const unavailableLocation = createGeolocation();
  const unavailableApp = setup(createStorage(), unavailableLocation.api);
  unavailableApp.elements.get("#share-location").checked = true;
  unavailableApp.click("#request-button");
  unavailableLocation.calls[0].error({ code });
  assert.equal(unavailableApp.store.getRequest().approximateLocation, null);
  assert.match(
    unavailableApp.elements.get("#location-feedback").textContent,
    feedback,
  );
}

const unsupportedApp = setup();
unsupportedApp.elements.get("#share-location").checked = true;
unsupportedApp.click("#request-button");
assert.equal(unsupportedApp.store.getRequest().approximateLocation, null);
assert.match(
  unsupportedApp.elements.get("#location-feedback").textContent,
  /isn’t available/,
);

const pendingLocation = createGeolocation();
const cancelledDuringLocation = setup(createStorage(), pendingLocation.api);
cancelledDuringLocation.elements.get("#share-location").checked = true;
cancelledDuringLocation.click("#request-button");
assert.equal(
  cancelledDuringLocation.elements.get("#location-without-button").hidden,
  false,
);
const locationCallback = pendingLocation.calls[0].success;
cancelledDuringLocation.click("#cancel-button");
locationCallback({
  coords: { latitude: 52.123456, longitude: 5.987654 },
});
assert.equal(cancelledDuringLocation.store.getRequest().status, "cancelled");
assert.equal(
  cancelledDuringLocation.store.getRequest().approximateLocation,
  null,
);

const continueWithoutGeo = createGeolocation();
const continueWithoutApp = setup(createStorage(), continueWithoutGeo.api);
continueWithoutApp.elements.get("#share-location").checked = true;
continueWithoutApp.click("#request-button");
continueWithoutApp.click("#location-without-button");
assert.equal(continueWithoutApp.store.getRequest().status, "pending");
assert.equal(continueWithoutApp.store.getRequest().approximateLocation, null);
assert.equal(
  continueWithoutApp.elements.get("#location-without-button").hidden,
  true,
);
continueWithoutGeo.calls[0].success({
  coords: { latitude: 52.123456, longitude: 5.987654 },
});
assert.equal(continueWithoutApp.store.getRequest().status, "pending");
assert.equal(continueWithoutApp.store.getRequest().approximateLocation, null);

const renewedLocation = createGeolocation();
const renewedApp = setup(createStorage(), renewedLocation.api);
renewedApp.elements.get("#share-location").checked = true;
renewedApp.click("#request-button");
renewedLocation.calls[0].success({
  coords: { latitude: 52.123456, longitude: 5.987654 },
});
assert.equal(renewedApp.elements.get("#request-location-preview").hidden, false);
renewedApp.click("#cancel-button");
assert.equal(renewedApp.store.getRequest().approximateLocation, null);
assert.equal(renewedApp.elements.get("#request-location-preview").hidden, true);
renewedApp.click("#request-button");
assert.equal(renewedApp.store.getRequest().approximateLocation, null);
assert.equal(renewedApp.elements.get("#request-location-preview").hidden, true);
assert.equal(renewedLocation.calls.length, 1);
assert.match(
  renewedApp.elements.get("#location-feedback").textContent,
  /sent without it/,
);
console.log(
  "Geslaagd: bestaande aanvraagflow en optionele locatie, toestemming, " +
    "afronding, fouten, annuleren tijdens GPS en nieuwe verzoeken.",
);
console.log(
  "Bestaand: openen, aanvragen, dubbele klikken, demo-ontvangst, " +
    "annuleren vóór/na ontvangst, opnieuw aanvragen, oude callbacks, " +
    "statusberichten en geluidsknop.",
);

async function checkReadableLocationPreview() {
  const geolocation = createGeolocation();
  let geocodeRequestUrl = "";
  const app = setup(
    createStorage(),
    geolocation.api,
    async (url, options) => {
      geocodeRequestUrl = url;
      assert.equal(options.referrerPolicy, "no-referrer");
      return {
        ok: true,
        async json() {
          return {
            features: [{
              properties: {
                street: "Market Street",
                neighbourhood: "Centrum",
                city: "Eindhoven",
                housenumber: "12",
              },
            }],
          };
        },
      };
    },
  );
  app.elements.get("#share-location").checked = true;
  app.click("#request-button");
  geolocation.calls[0].success({
    coords: { latitude: 52.123456, longitude: 5.987654 },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(geocodeRequestUrl.includes("lat=52.12"));
  assert.ok(geocodeRequestUrl.includes("lon=5.99"));
  assert.ok(!geocodeRequestUrl.includes("52.123456"));
  assert.equal(
    app.elements.get("#request-location-label").textContent,
    "Near Market Street, Centrum, Eindhoven",
  );
  assert.equal(
    app.store.getRequest().approximateLocation.label,
    "Near Market Street, Centrum, Eindhoven",
  );
  assert.ok(
    !app.elements.get("#request-location-label").textContent.includes("52.12"),
  );

  const unavailableGeolocation = createGeolocation();
  const unavailableApp = setup(
    createStorage(),
    unavailableGeolocation.api,
    async () => {
      throw new Error("Geocoding service unavailable");
    },
  );
  unavailableApp.elements.get("#share-location").checked = true;
  unavailableApp.click("#request-button");
  unavailableGeolocation.calls[0].success({
    coords: { latitude: 52.123456, longitude: 5.987654 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unavailableApp.store.getRequest().status, "pending");
  assert.equal(
    unavailableApp.elements.get("#request-location-preview").hidden,
    false,
  );
  assert.equal(
    unavailableApp.elements.get("#request-location-label").textContent,
    "Approximate location available",
  );
  console.log("Passed: readable approximate labels and lookup-failure fallback.");
}

checkReadableLocationPreview().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// Run with: node app.test.cjs
// These tests use Node built-ins and a simulated browser; no dependencies
// needed.
// assert checks expected results, fs reads the app, and vm runs it in
// isolation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("app.js", "utf8");
// Create a fresh browser-like environment for each scenario, optionally with
// saved data.
function setup(saved = null) {
  // Maps stand in for DOM elements and storage. callbacks captures location
  // requests
  // so tests can decide when they succeed/fail. listeners captures browser
  // events.
  // Minimal element objects expose the properties app.js uses. This is a logic
  // test,
  // not a real DOM renderer: it does not verify layout, focus or browser
  // behavior.
  const elements = new Map();
  const callbacks = [];
  const storage = new Map(saved ? [["linked-demo-v1", saved]] : []);
  const listeners = {};
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: "",
        textContent: "",
        hidden: false,
        value: "",
        classList: { toggle() {} },
        setAttribute() {},
      });
    return elements.get(selector);
  };
  // Supply fake browser APIs instead of accessing real locations or saved
  // alerts.
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [] },
    navigator: {
      geolocation: {
        getCurrentPosition: (success, error) =>
          callbacks.push({ success, error }),
      },
    },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    window: {
      addEventListener: (name, callback) => (listeners[name] = callback),
    },
    // Timers are stubbed so notification delays do not slow the test process.
    setTimeout: () => 1,
    clearTimeout() {},
    console,
  });
  // Evaluate the actual app, then expose a helper to run actions/read state
  // inside it.
  vm.runInContext(source, context);
  return {
    run: (code) => vm.runInContext(code, context),
    elements,
    callbacks,
    storage,
    listeners,
  };
}
// Startup must not request location without the visitor pressing a button.
const t = setup();
assert.equal(t.callbacks.length, 0, "No location request on startup");
// A first alert requests location once; a second trigger must not duplicate it.
t.run("trigger('App')");
assert.equal(t.callbacks.length, 1);
assert.equal(t.run("activeAlert().status"), "received");
t.run("trigger('Bracelet')");
assert.equal(
  t.callbacks.length,
  1,
  "Duplicate trigger does not create another alert",
);
assert.equal(t.run("state.alerts.length"), 1);
// Simulate permission success. Unassigned volunteers must not see the map link.
t.callbacks[0].success({
  coords: { latitude: 51.44, longitude: 5.48, accuracy: 20 },
});
assert.equal(t.run("activeAlert().location.lat"), 51.44);
assert.ok(
  !t.run("alertMarkup(activeAlert(),'volunteer')").includes("mlat="),
  "Unassigned volunteer cannot see location",
);
// Off-duty acceptance is blocked; switching on availability enables assignment.
t.run("acceptAlert(activeAlert().id)");
assert.equal(
  t.run("activeAlert().status"),
  "received",
  "Off-duty acceptance is blocked",
);
t.run("state.duty=true; acceptAlert(activeAlert().id)");
assert.equal(t.run("activeAlert().status"), "accepted");
assert.ok(
  t.elements.get("#help-content").innerHTML.includes("Alex has accepted"),
);
assert.ok(t.run("alertMarkup(activeAlert(),'volunteer')").includes("mlat="));
// Closing an alert removes both coordinates and meeting point, including
// storage.
t.run(
  "activeAlert().meetingPoint='Entrance'; " +
    "closeAlert(activeAlert().id,'closed')",
);
assert.equal(t.run("state.alerts[0].location"), null);
assert.equal(t.run("state.alerts[0].meetingPoint"), "");
assert.ok(
  !t.storage.get("linked-demo-v1").includes("51.44"),
  "Closed coordinates removed from storage",
);
// A location result arriving after cancellation must not restore private data.
t.run("trigger('Bracelet'); closeAlert(activeAlert().id,'cancelled')");
t.callbacks[1].success({
  coords: { latitude: 52, longitude: 6, accuracy: 10 },
});
assert.equal(
  t.run("state.alerts[0].location"),
  null,
  "Late permission result ignored after cancel",
);
t.run("trigger('App')");
// Permission denial leaves the meeting-point fallback available.
t.callbacks[2].error({ code: 1 });
assert.equal(t.run("activeAlert().locationStatus"), "denied");
assert.ok(t.elements.get("#help-content").innerHTML.includes("meeting-point"));
// HTML-looking meeting points must be displayed as text instead of executable
// HTML.
t.run("activeAlert().meetingPoint='<img src=x onerror=alert(1)>'");
assert.ok(
  t.run("alertMarkup(activeAlert(),'desk')").includes("&lt;img"),
  "Meeting points are escaped",
);
// Reloading saved data must not automatically restart geolocation.
const restored = setup(t.storage.get("linked-demo-v1"));
assert.equal(
  restored.callbacks.length,
  0,
  "Restoring an alert never starts location collection",
);
// Simulate another tab accepting an alert while its location request is
// pending.
const pending = setup();
pending.run("trigger('App')");
const updated = JSON.parse(pending.storage.get("linked-demo-v1"));
updated.duty = true;
updated.alerts[0].status = "accepted";
pending.listeners.storage({
  key: "linked-demo-v1",
  newValue: JSON.stringify(updated),
});
pending.callbacks[0].success({
  coords: { latitude: 51, longitude: 5, accuracy: 10 },
});
assert.equal(pending.run("activeAlert().status"), "accepted");
assert.equal(
  pending.run("activeAlert().location.lat"),
  51,
  "Cross-tab update preserves pending callback",
);
// Deleting shared storage resets the current tab too.
pending.listeners.storage({ key: "linked-demo-v1", newValue: null });
assert.equal(pending.run("state.alerts.length"), 0);
// A reload interrupts pending requests; mark them unavailable to enable retry.
const reloaded = setup(
  JSON.stringify({
    alerts: [
      {
        id: "a",
        status: "received",
        source: "App",
        locationStatus: "pending",
        time: Date.now(),
      },
    ],
  }),
);
assert.equal(
  reloaded.run("activeAlert().locationStatus"),
  "unavailable",
  "Interrupted location request can be retried",
);
console.log(
  "Passed: alert lifecycle, privacy, permissions, duplicate prevention, " +
    "volunteer duty, escaping, persistence, cross-tab updates.",
);

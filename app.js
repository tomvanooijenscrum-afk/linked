// This is a browser-only demo: state and alerts stay in this browser.
// Flow: user action -> change state -> save() -> render() updates all three
// views.
// $ is a short helper for finding one HTML element with a CSS selector.
const $ = (selector) => document.querySelector(selector);
// Use one named localStorage entry so the demo can restore data after a reload.
const storageKey = "linked-demo-v1";
// alerts holds alert objects; duty says whether our demo volunteer is
// available.
// Alert statuses: received -> accepted -> closed, or received/accepted ->
// cancelled.
let state = { alerts: [], duty: false };
// Convert saved JSON back into usable state. Reject invalid records, limit
// meeting
// point length, and only retain coordinates for alerts that are still active.
function readState(raw) {
  const saved = JSON.parse(raw);
  if (!saved || !Array.isArray(saved.alerts))
    return { alerts: [], duty: false };
  return {
    alerts: saved.alerts
      .filter(
        (a) =>
          a &&
          typeof a.id === "string" &&
          ["received", "accepted", "closed", "cancelled"].includes(a.status),
      )
      .map((a) => ({
        ...a,
        source: a.source === "Bracelet" ? "Bracelet" : "App",
        meetingPoint:
          typeof a.meetingPoint === "string"
            ? a.meetingPoint.slice(0, 120)
            : "",
        location:
          ["received", "accepted"].includes(a.status) &&
          a.location &&
          Number.isFinite(a.location.lat) &&
          Number.isFinite(a.location.lng)
            ? a.location
            : null,
      })),
    duty: Boolean(saved.duty),
  };
}
// Storage can be blocked or contain broken JSON. In that case keep the empty
// state.
try {
  state = readState(localStorage.getItem(storageKey));
} catch {}
// Incrementing this counter makes older asynchronous location callbacks
// obsolete.
// A callback must match the current counter before it may save coordinates.
let locationRequest = 0;
// Escape user-provided text before inserting it into an HTML template.
// Otherwise
// a meeting point containing HTML could create elements or run unwanted code.
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
// Find the first ongoing request. Closed and cancelled alerts are history only.
const activeAlert = () =>
  state.alerts.find((a) => ["received", "accepted"].includes(a.status));
// Keep the current notification timer so a new message replaces the old
// timeout.
let toastTimer;
// Show a brief notification. textContent treats the message as plain text.
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
// Store the state as JSON, then redraw the interface. If storage fails, the
// in-memory workflow still works until this page is closed or reloaded.
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    toast(
      "Browser storage is unavailable. This demo will last for this session.",
    );
  }
  render();
}
// Show one role section and hide the others. data-view in HTML identifies each
// tab; aria-pressed tells assistive technology which tab button is selected.
function switchView(view) {
  for (const name of ["home", "volunteer", "desk"])
    $(`#${name}-view`).hidden = name !== view;
  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
    button.setAttribute("aria-pressed", button.dataset.view === view);
  });
}
// Translate the internal location state into a message the visitor can
// understand.
function locationText(alert) {
  if (alert.location) return "Location shared for this active demo alert.";
  return (
    {
      pending: "Waiting for location permission…",
      denied:
        "Location unavailable. Add a meeting point " +
        "so the demo team knows where to go.",
      unavailable: "Location unavailable. Add a meeting point below.",
      idle: "No location shared.",
    }[alert.locationStatus] || "No location shared."
  );
}
// Ask the browser for ONE location reading, only after an alert or explicit
// retry.
// This does not continuously track the visitor and does not contact a real
// desk.
function requestLocation(alert) {
  // Capture the request number so both callbacks can detect cancellation/reset.
  const token = ++locationRequest;
  alert.locationStatus = "pending";
  save();
  // Some browsers do not expose geolocation; the meeting-point form is the
  // fallback.
  if (!navigator.geolocation) {
    alert.locationStatus = "unavailable";
    save();
    return;
  }
  // The browser asks for permission. Its success callback receives coordinates;
  // its error callback distinguishes denied permission (code 1) from other
  // errors.
  // Options request accuracy, wait at most 15 seconds, and avoid cached
  // readings.
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (
        token !== locationRequest ||
        !["received", "accepted"].includes(alert.status)
      )
        return;
      alert.location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      alert.locationStatus = "shared";
      save();
    },
    (error) => {
      if (
        token !== locationRequest ||
        !["received", "accepted"].includes(alert.status)
      )
        return;
      alert.locationStatus = error.code === 1 ? "denied" : "unavailable";
      save();
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
}
// Both the app button and simulated bracelet enter this same alert workflow.
function trigger(source) {
  // Prevent repeated button presses from creating duplicate active requests.
  if (activeAlert()) {
    switchView("home");
    toast("Your alert is already active.");
    return;
  }
  // Give the alert a unique ID and creation time. UUID is preferred; older
  // browsers
  // use a timestamp. No name, account, or location is needed to create the
  // alert.
  const alert = {
    id: globalThis.crypto?.randomUUID?.() || `alert-${Date.now()}`,
    source,
    status: "received",
    time: Date.now(),
    location: null,
    locationStatus: "idle",
    meetingPoint: "",
  };
  // Put the newest alert first, show the user view, then request location
  // consent.
  state.alerts.unshift(alert);
  switchView("home");
  requestLocation(alert);
}
// Used for both cancellation by the visitor and closure by the demo help point.
function closeAlert(id, status) {
  const alert = state.alerts.find((a) => a.id === id);
  if (!alert || !["received", "accepted"].includes(alert.status)) return;
  // Invalidate pending readings and remove location/meeting point from both
  // memory and the saved record. Keep the status so the history can explain
  // closure.
  locationRequest++;
  alert.status = status;
  alert.location = null;
  alert.locationStatus = "idle";
  alert.meetingPoint = "";
  save();
  toast(
    status === "cancelled"
      ? "Alert cancelled. Location has been cleared."
      : "Alert closed. Location has been cleared.",
  );
}
// Only our available demo volunteer may accept a request that is still
// received.
// Alex is a simulated responder; role buttons are not real authentication.
function acceptAlert(id) {
  if (!state.duty)
    return toast("Switch on availability before accepting an alert.");
  const alert = state.alerts.find((a) => a.id === id);
  if (!alert || alert.status !== "received") return;
  alert.status = "accepted";
  alert.volunteer = "Alex";
  save();
  toast("Demo alert accepted. The help point can see your assignment.");
}
// Rebuild the visitor card from state: idle card, received alert, or accepted
// alert.
// Backtick strings are HTML templates; ${...} inserts values or optional
// sections.
function renderHome() {
  const alert = activeAlert();
  const privacyMessage = alert?.location
    ? "Location shared for this alert"
    : alert?.locationStatus === "pending"
      ? "Location permission requested"
      : "Location sharing is off";
  $("#privacy-status").innerHTML = `
    <i class="dot"></i>
    ${privacyMessage}
  `;
  // No active request: show the help button and, if available, the last
  // outcome.
  if (!alert) {
    const last = state.alerts[0];
    const lastOutcome = last?.status === "cancelled" ? "cancelled" : "closed";
    const lastMessage = last
      ? `
        <div class="status-banner">
          Your last alert was ${lastOutcome}.
          Location sharing has ended.
        </div>
      `
      : "";
    $("#help-content").innerHTML = `
      <h2>Something doesn’t feel right?</h2>
      <p>
        You can ask for help, even if you’re not sure.<br>
        A nearby human connection starts here.
      </p>
      ${lastMessage}
      <button class="primary alert-button" id="ask-help">
        <span>↗ &nbsp; I need help</span>
        <span aria-hidden="true">→</span>
      </button>
      <div class="help-footnote">
        ⌖ &nbsp; Your location is requested only after you press.
      </div>
      <div class="demo-note">
        Demo only — no real help is dispatched.
        In an emergency, call <a href="tel:112">112</a>.
      </div>
    `;
    // innerHTML creates a new button, so attach its event handler after
    // rendering.
    $("#ask-help").onclick = () => trigger("App");
    return;
  }
  // Active request: show progress, location feedback, meeting-point input and
  // cancel.
  const accepted = alert.status === "accepted";
  const heading = accepted
    ? "Alex has accepted your alert."
    : "Your demo alert is received.";
  const description = accepted
    ? "The demo help point is coordinating your response."
    : "It’s now visible in the Help point and Volunteer views.";
  const retryButton =
    !alert.location && alert.locationStatus !== "pending"
      ? `
      <button class="secondary" id="retry-location">
        Retry location
      </button>
    `
      : "";
  $("#help-content").innerHTML = `
    <h2>${heading}</h2>
    <p>${description}</p>
    <div class="progress">
      <span class="complete">1 · Received</span>
      <span class="${accepted ? "complete" : ""}">2 · Accepted</span>
      <span>3 · Closed</span>
    </div>
    <div
      class="status-banner ${alert.location ? "" : "warning"}"
      role="status"
    >
      ${locationText(alert)}
    </div>
    <label for="meeting-point" class="muted">
      Where can someone find you? (optional)
    </label>
    <form id="meeting-form" class="actions">
      <input
        id="meeting-point"
        maxlength="120"
        placeholder="e.g. outside the main entrance"
        value="${escapeHTML(alert.meetingPoint)}"
      >
      <button class="secondary" type="submit">Save</button>
    </form>
    <div class="actions">
      <button class="secondary" id="cancel-alert">Cancel alert</button>
      ${retryButton}
    </div>
    <div class="demo-note">
      ${escapeHTML(alert.source)} alert · Demo only.
      No real help is dispatched.
      In an emergency, call <a href="tel:112">112</a>.
    </div>
  `;
  // These controls were recreated above, so their handlers must also be
  // reattached.
  $("#cancel-alert").onclick = () => closeAlert(alert.id, "cancelled");
  if ($("#retry-location"))
    $("#retry-location").onclick = () => requestLocation(alert);
  // preventDefault stops a form submission from reloading the page. Trim
  // whitespace
  // and save the meeting point instead; escaping happens when it is rendered.
  $("#meeting-form").onsubmit = (event) => {
    event.preventDefault();
    alert.meetingPoint = $("#meeting-point").value.trim();
    save();
    toast("Meeting point updated for the demo team.");
  };
}
// Return the HTML for one responder/desk card. This builds a string; render()
// inserts the result into the page and connects the accept/close buttons.
function alertMarkup(alert, role) {
  const active = ["received", "accepted"].includes(alert.status);
  const location = alert.location;
  // Desk sees active locations; the volunteer view reveals them after
  // acceptance.
  // This is a demo display rule, not secure server-enforced access control.
  const canSeeLocation = role === "desk" || alert.status === "accepted";
  // Optional sections show meeting point/map only while active and permitted.
  // Number() ensures map coordinates become numbers; rel protects the new tab.
  // The map is loaded only when its link is opened, not automatically by this
  // app.
  const time = new Date(alert.time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const heading = {
    received: "A person is asking for help",
    accepted: "Assigned to Alex",
    closed: "Response closed",
    cancelled: "Alert cancelled",
  }[alert.status];
  const description = active
    ? canSeeLocation
      ? locationText(alert)
      : "Accept this alert to see its location and meeting point."
    : "Location and meeting point have been cleared.";
  const meetingPoint =
    active && canSeeLocation && alert.meetingPoint
      ? `
      <p>
        <strong>Meeting point:</strong>
        ${escapeHTML(alert.meetingPoint)}
      </p>
    `
      : "";

  // Build a long URL from shorter pieces without adding spaces to the URL.
  let mapDetails = "";
  if (active && canSeeLocation && location) {
    const latitude = Number(location.lat);
    const longitude = Number(location.lng);
    const mapUrl =
      "https://www.openstreetmap.org/" +
      `?mlat=${latitude}&mlon=${longitude}` +
      `#map=18/${latitude}/${longitude}`;
    mapDetails = `
      <a
        class="location-link"
        href="${mapUrl}"
        target="_blank"
        rel="noopener noreferrer"
      >
        View location on map ↗
      </a>
      <p class="muted">
        Approximate accuracy: ${Math.round(location.accuracy)} m ·
        Opening the map sends coordinates to OpenStreetMap.
      </p>
    `;
  }
  const acceptButton =
    role === "volunteer" && alert.status === "received"
      ? `
      <button
        class="primary"
        data-accept="${escapeHTML(alert.id)}"
        ${state.duty ? "" : "disabled"}
      >
        Accept alert ↗
      </button>
    `
      : "";
  const closeButton =
    role === "desk" && active
      ? `
      <button class="secondary" data-close="${escapeHTML(alert.id)}">
        Close response
      </button>
    `
      : "";
  return `
    <article class="alert-item">
      <div class="card-top">
        <span class="tag">${escapeHTML(alert.source)} alert</span>
        <span class="muted">${time}</span>
      </div>
      <h3>${heading}</h3>
      <p>${description}</p>
      ${meetingPoint}
      ${mapDetails}
      <div class="actions">
        ${acceptButton}
        ${closeButton}
      </div>
    </article>
  `;
}
// Redraw all views so a change in one role is immediately reflected in the
// others.
function render() {
  renderHome();
  $("#on-duty").checked = state.duty;
  // Volunteers see active alerts; the desk also sees closed/cancelled history.
  const available = state.alerts.filter((a) =>
    ["received", "accepted"].includes(a.status),
  );
  $("#desk-count").textContent =
    `${available.length} active alert${available.length === 1 ? "" : "s"}`;
  $("#desk-alerts").innerHTML = state.alerts.length
    ? state.alerts.map((a) => alertMarkup(a, "desk")).join("")
    : `
      <div class="empty-state">
        <h2>A quiet night, for now.</h2>
        <p>Trigger an app or bracelet demo alert to see it here.</p>
      </div>
    `;
  $("#volunteer-alerts").innerHTML = !state.duty
    ? `
      <div class="empty-state">
        <h2>Take a moment. Then be there.</h2>
        <p>Switch on availability when you’re ready to receive demo alerts.</p>
      </div>
    `
    : available.length
      ? available.map((a) => alertMarkup(a, "volunteer")).join("")
      : `
        <div class="empty-state">
          <h2>You’re available to help.</h2>
          <p>Active demo alerts will appear here.</p>
        </div>
      `;
  // data-accept/data-close carry the alert ID for each dynamically created
  // button.
  document
    .querySelectorAll("[data-accept]")
    .forEach(
      (button) => (button.onclick = () => acceptAlert(button.dataset.accept)),
    );
  document
    .querySelectorAll("[data-close]")
    .forEach(
      (button) =>
        (button.onclick = () => closeAlert(button.dataset.close, "closed")),
    );
}
// Connect the permanent controls once at startup. Arrow functions run on
// clicks.
document
  .querySelectorAll(".nav")
  .forEach(
    (button) => (button.onclick = () => switchView(button.dataset.view)),
  );
// Keep the brand link from jumping to #; use it to return to the visitor view.
$("header .brand").onclick = (event) => {
  event.preventDefault();
  switchView("home");
};
// The checkbox controls volunteer availability and persists it with the alerts.
$("#on-duty").onchange = (event) => {
  state.duty = event.target.checked;
  save();
};
// Native HTML dialogs handle modal focus and support closing with Escape.
$("#about").onclick = () => $("#info-dialog").showModal();
$("#bracelet").onclick = () => $("#bracelet-dialog").showModal();
document
  .querySelectorAll(".dialog-close,.dialog-dismiss")
  .forEach(
    (button) => (button.onclick = () => button.closest("dialog").close()),
  );
// Close the explanation dialog and simulate a bracelet using the same trigger.
$("#bracelet-trigger").onclick = () => {
  $("#bracelet-dialog").close();
  trigger("Bracelet");
};
// Reset clears local demo data and invalidates any outstanding location
// reading.
$("#reset").onclick = () => {
  locationRequest++;
  state = { alerts: [], duty: false };
  save();
  switchView("home");
  toast("Demo reset. All stored alerts and locations cleared.");
};
// Other tabs on the same origin receive this event when localStorage changes.
// It lets role views in separate tabs share the same local demo state.
window.addEventListener("storage", (event) => {
  // Ignore storage changes belonging to other applications or keys.
  if (event.key !== storageKey) return;
  try {
    const incoming = readState(event.newValue);
    // Keep a pending request linked to the current alert object across tab
    // updates.
    // A location callback holds a reference to its alert object. Keep that
    // object
    // when another tab accepts it, so a later reading updates the current
    // state.
    const pending = activeAlert();
    const updated =
      pending &&
      incoming.alerts.find(
        (a) =>
          a.id === pending.id && ["received", "accepted"].includes(a.status),
      );
    // If the alert was removed or ended in another tab, invalidate its
    // callback.
    if (updated) {
      Object.assign(pending, updated);
      incoming.alerts = incoming.alerts.map((a) =>
        a.id === pending.id ? pending : a,
      );
    } else locationRequest++;
    state = incoming;
    render();
  } catch {}
});
// A request cannot survive a reload: allow the visitor to retry explicitly.
state.alerts.forEach((a) => {
  if (a.locationStatus === "pending") a.locationStatus = "unavailable";
});
// Startup: show the visitor view and draw either restored data or the empty
// demo.
switchView("home");
render();

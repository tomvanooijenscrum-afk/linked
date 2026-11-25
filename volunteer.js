// Vrijwilligerspagina. De aanvragen staan op de server; elk apparaat van
// een ingelogde vrijwilliger vraagt ze regelmatig op, zodat iedereen
// dezelfde lijst ziet en een acceptatie overal doorkomt.
const $ = (id) => document.getElementById(id);
const el = {
  pageMessage: $("page-message"),
  signedInAs: $("signed-in-as"),
  signOut: $("sign-out"),
  signinCard: $("signin-card"),
  signinForm: $("signin-form"),
  signinUsername: $("signin-username"),
  signinPassword: $("signin-password"),
  signinError: $("signin-error"),
  signinSubmit: $("signin-submit"),
  volunteerArea: $("volunteer-area"),
  availabilityCard: $("availability-card"),
  availabilityToggle: $("availability-toggle"),
  availabilityValue: $("availability-value"),
  availabilityHint: $("availability-hint"),
  nearbyStatus: $("nearby-status"),
  requestsMap: $("requests-map"),
  requestList: $("tap-request-list"),
  clearRequests: $("clear-tap-requests"),
  alert: $("tap-alert"),
  alertText: $("tap-alert-text"),
  dismissAlert: $("dismiss-tap-alert"),
  readerStatus: $("reader-status"),
};
const requestStore = globalThis.LinkedRequestStore;
const geo = globalThis.LinkedGeo;
const requestMap = globalThis.LinkedRequestMap;
const api = globalThis.LinkedWristbandApi.createApi();

const volunteerRoles = new Set(["volunteer", "admin"]);
const requestPollInterval = 3000;
// De lokale NFC-brug (nfc/bridge/bridge.py) draait alleen op de computer
// met de lezer. Op de gehoste site wordt hij niet gezocht.
const bridgeUrl = "http://127.0.0.1:5001";
const bridgeEnabled = ["localhost", "127.0.0.1", "[::1]"].includes(
  globalThis.location?.hostname,
);
const tapPollInterval = 1500;
const readerMessages = {
  starting: "Wristband reader: starting…",
  listening: "Wristband reader: listening for taps.",
  disconnected:
    "Wristband reader: Arduino not connected. Close Serial Monitor if it is open.",
};

const errorMessages = {
  ALREADY_ACCEPTED: "Another volunteer already accepted this request.",
  REQUEST_CANCELLED: "This request was cancelled by the requester.",
  NOT_FOUND: "This request no longer exists.",
  INVALID_CREDENTIALS: "Wrong username or password.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait a few minutes and try again.",
  FORBIDDEN: "This account cannot see help requests. Sign in as a volunteer.",
  SERVER_OFFLINE: "Could not reach Linked. Check your internet connection.",
};

let user = null;
let requests = [];
let loaded = false;
let offline = false;
// Aanvragen die deze vrijwilliger al gezien heeft: alleen nieuwe geven een melding.
const seenIds = new Set();
let alertedRequestId = null;
let pollTimer = null;
let refreshing = false;
let lastTapId = null;
let isPollingTaps = false;
let tapTimer = null;
// Wat er nu in de lijst staat. Alleen opnieuw opbouwen als dat verandert,
// anders verliest een toetsenbordgebruiker elke paar seconden de focus.
let renderedList = null;

function describe(code) {
  return errorMessages[code] ?? "Something went wrong. Try again.";
}

function showPageMessage(text) {
  el.pageMessage.textContent = text ?? "";
  el.pageMessage.hidden = !text;
}

function formatDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} m away`
    : `${(meters / 1000).toFixed(1)} km away`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(Date.parse(timestamp));
}

function describeSource(request) {
  const band = request.wristbandLabel ?? request.tagUid;
  const event = request.eventName ? ` at ${request.eventName}` : "";
  if (request.source === "wristband") return `wristband ${band}${event}`;
  if (request.source === "reader") return `wristband ${band}${event} (reader)`;
  return "via the Linked app";
}

function stateText(request, isClosest) {
  if (request.status === "accepted") {
    return request.acceptedByMe
      ? "Accepted by you"
      : `Accepted by ${request.acceptedBy ?? "a volunteer"}`;
  }
  return isClosest ? "Closest" : "Waiting";
}

function isAvailable() {
  return requestStore.getAvailability() === "available";
}

function createRequestItem(request, isClosest) {
  const item = document.createElement("li");
  item.className = "tap-request";
  item.dataset.closest = String(isClosest);
  item.dataset.status = request.status;

  const text = document.createElement("div");
  const title = document.createElement("p");
  title.className = "tap-request-title";
  title.textContent = request.label;
  const state = document.createElement("span");
  state.className = "request-state";
  state.textContent = stateText(request, isClosest);
  title.append(state);
  const details = document.createElement("p");
  details.textContent =
    `${formatDistance(request.distanceMeters)} · ` +
    `${describeSource(request)} · ${formatTime(request.createdAt)}`;
  text.append(title, details);
  item.append(text);

  if (request.status === "pending") {
    const button = document.createElement("button");
    button.className = "primary";
    button.type = "button";
    button.textContent = "Accept";
    button.setAttribute("aria-label", `Accept ${request.label}`);
    button.addEventListener("click", () => acceptRequest(request.id, button));
    item.append(button);
  }

  return item;
}

function renderRequests() {
  const available = isAvailable();
  // Nummers volgen de volgorde van binnenkomst (de server geeft oudste eerst).
  const labelled = requests.map((request, index) => ({
    ...request,
    label: `Request ${index + 1}`,
    distanceMeters: geo.distanceMeters(geo.volunteerLocation, request.location),
  }));
  // Onbeschikbaar: wachtende aanvragen blijven bestaan, maar zijn verborgen.
  const visible = labelled
    .filter((request) => available || request.status === "accepted")
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  const pending = visible.filter((request) => request.status === "pending");
  const closestId = pending[0]?.id;
  const ordered = [
    ...visible.filter((request) => request.id === closestId),
    ...visible.filter((request) => request.id !== closestId),
  ];

  const signature = JSON.stringify(
    ordered.map((request) => [
      request.id,
      request.label,
      request.status,
      request.acceptedBy,
      request.id === closestId,
    ]),
  );
  const listChanged = signature !== renderedList;
  if (listChanged) {
    renderedList = signature;
    el.requestList.replaceChildren(
      ...ordered.map((request) => createRequestItem(request, request.id === closestId)),
    );
  }
  el.clearRequests.hidden = user?.role !== "admin" || requests.length === 0;

  let status;
  if (!loaded) {
    status = offline ? "Could not reach Linked. Trying again…" : "Loading requests…";
  } else if (pending.length > 0) {
    status =
      `${pending.length} waiting. Closest: ` +
      `${formatDistance(pending[0].distanceMeters)}.`;
  } else if (!available) {
    status = "You are unavailable. New requests are not shown.";
  } else if (visible.length > 0) {
    status = "All requests have been accepted.";
  } else {
    status = "No requests right now. New requests appear here automatically.";
  }
  if (loaded && offline) status += " Connection lost, trying again…";
  el.nearbyStatus.textContent = status;

  if (!available || !pending.some((request) => request.id === alertedRequestId)) {
    el.alert.hidden = true;
  }

  if (listChanged) requestMap.update(el.requestsMap, geo.volunteerLocation, ordered);
}

function render() {
  const signedIn = user !== null && volunteerRoles.has(user.role);
  el.signinCard.hidden = signedIn;
  el.volunteerArea.hidden = !signedIn;
  el.signOut.hidden = user === null;
  el.signedInAs.hidden = user === null;
  el.signedInAs.textContent = user ? `Signed in as ${user.username}` : "";
  el.readerStatus.hidden = !bridgeEnabled;
  if (!signedIn) return;

  const available = isAvailable();
  el.availabilityCard.dataset.state = available ? "available" : "unavailable";
  el.availabilityToggle.setAttribute("aria-checked", String(available));
  el.availabilityValue.textContent = available ? "Available" : "Unavailable";
  el.availabilityHint.textContent = available
    ? "New requests appear below."
    : "New requests are paused and not shown.";
  renderRequests();
}

// Melding voor aanvragen die sinds de vorige keer zijn binnengekomen.
function announceNewRequests(previouslyLoaded) {
  const fresh = requests.filter(
    (request) => request.status === "pending" && !seenIds.has(request.id),
  );
  requests.forEach((request) => seenIds.add(request.id));
  if (!previouslyLoaded || fresh.length === 0 || !isAvailable()) return;

  const newest = fresh[fresh.length - 1];
  const distance = geo.distanceMeters(geo.volunteerLocation, newest.location);
  alertedRequestId = newest.id;
  const who =
    newest.source === "app"
      ? "Someone asked for help"
      : `Wristband ${newest.wristbandLabel ?? newest.tagUid} asked for help`;
  el.alertText.textContent =
    `${who} just now, ${formatDistance(distance)}. See the map below.`;
  el.alert.hidden = false;
}

async function refresh() {
  if (refreshing || !user) return;
  refreshing = true;
  const result = await api.listHelpRequests();
  refreshing = false;

  if (result.ok) {
    offline = false;
    const previouslyLoaded = loaded;
    requests = result.requests;
    loaded = true;
    announceNewRequests(previouslyLoaded);
  } else if (result.httpStatus === 401 || result.httpStatus === 403) {
    // Sessie verlopen of rol ingetrokken.
    stop();
    user = null;
    if (result.httpStatus === 403) showPageMessage(describe("FORBIDDEN"));
  } else {
    offline = true;
  }
  render();
}

function schedule() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    // Op de achtergrond niet vragen: scheelt batterij en serververzoeken.
    if (document.visibilityState !== "hidden") await refresh();
    if (user) schedule();
  }, requestPollInterval);
}

function stop() {
  clearTimeout(pollTimer);
  clearTimeout(tapTimer);
  pollTimer = null;
  tapTimer = null;
}

async function start() {
  showPageMessage(null);
  render();
  await refresh();
  if (!user) return;
  schedule();
  if (bridgeEnabled) pollTaps();
}

async function acceptRequest(requestId, button) {
  if (!isAvailable()) {
    render();
    return;
  }
  button.disabled = true;
  const result = await api.acceptHelpRequest(requestId);
  if (!result.ok) {
    showPageMessage(describe(result.error));
  } else {
    showPageMessage(null);
  }
  await refresh();
}

async function clearRequests() {
  const result = await api.clearHelpRequests();
  if (!result.ok) showPageMessage(describe(result.error));
  alertedRequestId = null;
  await refresh();
}

function toggleAvailability() {
  requestStore.setAvailability(isAvailable() ? "unavailable" : "available");
  render();
}

function dismissAlert() {
  el.alert.hidden = true;
  alertedRequestId = null;
  el.nearbyStatus.focus();
}

// Een tik op de lezer van deze vrijwilliger wordt een gedeelde aanvraag.
async function handleTap(tap) {
  const result = await api.createHelpRequest({ tagUid: tap.uid });
  if (!result.ok) showPageMessage(describe(result.error));
}

async function pollTaps() {
  if (isPollingTaps || !user) return;

  isPollingTaps = true;
  try {
    const query = lastTapId === null ? "" : `?after=${lastTapId}`;
    const response = await fetch(`${bridgeUrl}/api/nfc/taps${query}`);
    const result = await response.json();
    el.readerStatus.textContent =
      readerMessages[result.reader] ?? readerMessages.starting;

    // Bij de eerste vraag tellen eerdere tikken niet mee.
    if (lastTapId !== null && result.taps.length > 0) {
      for (const tap of result.taps) await handleTap(tap);
      await refresh();
    }
    lastTapId = result.latest;
  } catch {
    el.readerStatus.textContent =
      "Wristband reader: bridge offline. Start nfc/bridge/bridge.py.";
  } finally {
    isPollingTaps = false;
    if (user) tapTimer = setTimeout(pollTaps, tapPollInterval);
  }
}

async function signIn(event) {
  event.preventDefault();
  el.signinSubmit.disabled = true;
  const result = await api.login(el.signinUsername.value, el.signinPassword.value);
  el.signinSubmit.disabled = false;
  el.signinPassword.value = "";
  if (!result.ok) {
    el.signinError.textContent = describe(result.error);
    el.signinError.hidden = false;
    return;
  }
  el.signinError.hidden = true;
  user = result.user;
  if (!volunteerRoles.has(user.role)) {
    showPageMessage(describe("FORBIDDEN"));
    render();
    return;
  }
  await start();
}

async function signOut() {
  stop();
  await api.logout();
  user = null;
  requests = [];
  loaded = false;
  renderedList = null;
  seenIds.clear();
  el.alert.hidden = true;
  render();
}

async function checkSession() {
  const result = await api.me();
  if (result.ok) {
    user = result.user;
    if (volunteerRoles.has(user.role)) {
      await start();
      return;
    }
    showPageMessage(describe("FORBIDDEN"));
  } else if (result.httpStatus !== 401) {
    showPageMessage(describe(result.error));
  }
  render();
}

globalThis.addEventListener("storage", (event) => {
  if (event.key === requestStore.availabilityKey) render();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && user) refresh();
});

el.signinForm.addEventListener("submit", signIn);
el.signOut.addEventListener("click", signOut);
el.availabilityToggle.addEventListener("click", toggleAvailability);
el.dismissAlert.addEventListener("click", dismissAlert);
el.clearRequests.addEventListener("click", clearRequests);

globalThis.LinkedVolunteer = Object.freeze({ ready: checkSession() });

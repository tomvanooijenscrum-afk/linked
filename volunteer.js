const inboxStatus = document.querySelector("#inbox-status");
const availabilityCard = document.querySelector("#availability-card");
const availabilityToggle = document.querySelector("#availability-toggle");
const availabilityValue = document.querySelector("#availability-value");
const availabilityHint = document.querySelector("#availability-hint");
const pendingRequestCard = document.querySelector("#pending-request");
const acceptedRequestCard = document.querySelector("#accepted-request");
const emptyState = document.querySelector("#empty-state");
const unavailableState = document.querySelector("#unavailable-state");
const requestReceived = document.querySelector("#request-received");
const openRequestButton = document.querySelector("#open-request");
const requestDetails = document.querySelector("#request-details");
const acceptRequestButton = document.querySelector("#accept-request");
const nearbyStatus = document.querySelector("#nearby-status");
const requestsMap = document.querySelector("#requests-map");
const tapRequestList = document.querySelector("#tap-request-list");
const clearTapRequestsButton = document.querySelector("#clear-tap-requests");
const tapAlert = document.querySelector("#tap-alert");
const tapAlertText = document.querySelector("#tap-alert-text");
const dismissTapAlertButton = document.querySelector("#dismiss-tap-alert");
const readerStatus = document.querySelector("#reader-status");
const acceptedLocation = document.querySelector("#accepted-location");
const acceptedLocationMap = document.querySelector("#accepted-location-map");
const acceptedLocationLabel = document.querySelector("#accepted-location-label");
const acceptedNoLocation = document.querySelector("#accepted-no-location");
const requestStore = globalThis.LinkedRequestStore;
const tapRequestStore = globalThis.LinkedTapRequestStore;
const requestMap = globalThis.LinkedRequestMap;

// De lokale NFC-brug meldt tikken van polsbandjes; zie nfc/bridge/bridge.py.
const bridgeUrl = "http://127.0.0.1:5001";
const tapPollInterval = 1500;
const readerMessages = {
  starting: "Wristband reader: starting…",
  listening: "Wristband reader: listening for taps.",
  disconnected:
    "Wristband reader: Arduino not connected. Close Serial Monitor if it is open.",
};

let selectedOverviewId = null;
let overviewNumbers = {};
try { overviewNumbers = JSON.parse(localStorage.getItem("linked.overview-numbers.v1") || "{}"); if (!overviewNumbers || typeof overviewNumbers !== "object" || Array.isArray(overviewNumbers)) overviewNumbers = {}; } catch {}
let currentRequest = null;
let lastTapId = null;
let isPollingTaps = false;
// Het verzoek waarover de melding gaat; de melding verdwijnt na acceptatie.
let alertedRequestId = null;

function formatReceivedTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} m away`
    : `${(meters / 1000).toFixed(1)} km away`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(timestamp);
}

function createTapRequestItem(request, isClosest) {
  const item = document.createElement("li");
  item.className = "tap-request";
  item.dataset.closest = String(isClosest);

  const text = document.createElement("div");
  const title = document.createElement("p");
  title.className = "tap-request-title";
  title.textContent = `${request.label}`;
  const state = document.createElement("span");
  state.className = "request-state";
  state.textContent =
    request.status === "accepted"
      ? "Accepted"
      : isClosest
        ? "Closest"
        : "Waiting";
  title.append(state);
  const details = document.createElement("p");
  details.textContent =
    `${formatDistance(request.distanceMeters)} · ` +
    `wristband ${request.wristbandUid} · ${formatTime(request.createdAt)}`;
  text.append(title, details);
  item.append(text);

  if (request.status === "pending") {
    const button = document.createElement("button");
    button.className = "primary";
    button.type = "button";
    button.textContent = "Accept";
    button.setAttribute("aria-label", `Accept ${request.label}`);
    button.addEventListener("click", () => acceptTapRequest(request.id));
    item.append(button);
  }

  return item;
}

function renderNearby(isAvailable) {
  // Onbeschikbaar: wachtende verzoeken blijven bewaard, maar zijn verborgen.
  const requests = tapRequestStore
    .getTapRequestsByDistance()
    .filter((request) => isAvailable || request.status === "accepted");
  const pending = requests.filter((request) => request.status === "pending");
  const closestId = pending[0]?.id;
  // Nummers volgen de volgorde van binnenkomst, zodat ze niet verspringen.
  const arrival = tapRequestStore
    .getTapRequests()
    .map((request) => request.id);
  const labelled = requests.map((request) => ({
    ...request,
    label: `Request ${arrival.indexOf(request.id) + 1}`,
  }));
  const mapRequests = [
    ...labelled.filter((request) => request.id === closestId),
    ...labelled.filter((request) => request.id !== closestId),
  ];

  tapRequestList.replaceChildren(
    ...mapRequests.map((request) =>
      createTapRequestItem(request, request.id === closestId),
    ),
  );
  clearTapRequestsButton.hidden =
    tapRequestStore.getTapRequests().length === 0;

  if (pending.length > 0) {
    nearbyStatus.textContent =
      `${pending.length} waiting. Closest: ` +
      `${formatDistance(pending[0].distanceMeters)}.`;
  } else if (!isAvailable) {
    nearbyStatus.textContent =
      "You are unavailable. Wristband requests are not shown.";
  } else if (requests.length > 0) {
    nearbyStatus.textContent = "All wristband requests have been accepted.";
  } else {
    nearbyStatus.textContent =
      "No wristband requests yet. Tap a wristband on the reader.";
  }

  if (
    !isAvailable ||
    !pending.some((request) => request.id === alertedRequestId)
  ) {
    tapAlert.hidden = true;
  }

  renderOverview(isAvailable);
}

function render() {
  currentRequest = requestStore.getRequest();
  const isAvailable = requestStore.getAvailability() === "available";
  const isPending = currentRequest?.status === "pending";
  const isAccepted = currentRequest?.status === "accepted";
  // Een wachtend verzoek blijft bewaard, maar is alleen zichtbaar
  // als de vrijwilliger beschikbaar is.
  const showPending = isPending && isAvailable;
  const approximateLocation =
    isAccepted && currentRequest.approximateLocation;

  availabilityCard.dataset.state = isAvailable ? "available" : "unavailable";
  availabilityToggle.setAttribute("aria-checked", String(isAvailable));
  availabilityValue.textContent = isAvailable ? "Available" : "Unavailable";
  availabilityHint.textContent = isAvailable
    ? "New requests appear in your inbox."
    : "New requests are paused and not shown in your inbox.";
  pendingRequestCard.hidden = !showPending;
  acceptedRequestCard.hidden = !isAccepted;
  // Locatie staat alleen in de kaart na acceptatie; localStorage is geen toegangscontrole.
  acceptedLocation.hidden = !approximateLocation;
  acceptedNoLocation.hidden = !isAccepted || Boolean(approximateLocation);
  acceptedNoLocation.textContent = "No location shared.";
  if (approximateLocation) {
    globalThis.LinkedApproximateMap.update(
      acceptedLocationMap,
      approximateLocation,
    );
    acceptedLocationLabel.textContent =
      approximateLocation.label || "Approximate location available";
  } else {
    globalThis.LinkedApproximateMap.update(acceptedLocationMap, null);
    acceptedLocationLabel.textContent = "";
  }
  unavailableState.hidden = isAvailable || isAccepted;
  emptyState.hidden = !isAvailable || isPending || isAccepted;

  if (showPending) {
    inboxStatus.textContent = "A new request is waiting for a volunteer.";
    requestReceived.textContent =
      `Received ${formatReceivedTime(currentRequest.createdAt)}`;
  } else if (isAccepted) {
    inboxStatus.textContent = "This request has been accepted.";
  } else if (!isAvailable) {
    inboxStatus.textContent =
      "You are unavailable. New requests are not shown.";
  } else {
    inboxStatus.textContent = "No pending requests right now.";
  }

  if (!showPending) {
    requestDetails.hidden = true;
    openRequestButton.setAttribute("aria-expanded", "false");
  }
  acceptRequestButton.disabled = !showPending;
  renderNearby(isAvailable);
}

function toggleAvailability() {
  const nextStatus =
    requestStore.getAvailability() === "available"
      ? "unavailable"
      : "available";
  requestStore.setAvailability(nextStatus);
  render();
}

function toggleRequestDetails() {
  const isOpen = !requestDetails.hidden;
  requestDetails.hidden = isOpen;
  openRequestButton.setAttribute("aria-expanded", String(!isOpen));
  if (isOpen) {
    openRequestButton.focus();
  } else {
    acceptRequestButton.focus();
  }
}

function acceptRequest() {
  if (
    requestStore.getAvailability() !== "available" ||
    !currentRequest ||
    currentRequest.status !== "pending"
  ) {
    render();
    return;
  }

  acceptRequestButton.disabled = true;
  const acceptedRequest = requestStore.acceptRequest(currentRequest.id);
  if (!acceptedRequest) {
    render();
    return;
  }

  currentRequest = acceptedRequest;
  render();
}

function acceptTapRequest(requestId) {
  if (requestStore.getAvailability() !== "available") {
    render();
    return;
  }

  tapRequestStore.acceptTapRequest(requestId);
  render();
}

function clearTapRequests() {
  tapRequestStore.clearTapRequests();
  render();
}

// Voor deze demo geldt elk polsbandje als geregistreerd en telt elke tik
// als een nieuw persoon op een hypothetische plek in de buurt.
function handleTap(tap) {
  const request = tapRequestStore.createTapRequest(tap.uid);
  if (!request) {
    return;
  }

  if (requestStore.getAvailability() === "available") {
    const distance = tapRequestStore.distanceMeters(
      tapRequestStore.volunteerLocation,
      request.location,
    );
    alertedRequestId = request.id;
    tapAlertText.textContent =
      `Wristband ${tap.uid} was tapped just now, ` +
      `${formatDistance(distance)}. See the map below.`;
    tapAlert.hidden = false;
  }
  render();
}

async function pollTaps() {
  if (isPollingTaps) {
    return;
  }

  isPollingTaps = true;
  try {
    const query = lastTapId === null ? "" : `?after=${lastTapId}`;
    const response = await fetch(`${bridgeUrl}/api/nfc/taps${query}`);
    const result = await response.json();
    readerStatus.textContent =
      readerMessages[result.reader] ?? readerMessages.starting;

    // Bij de eerste vraag tellen eerdere tikken niet mee.
    if (lastTapId !== null) {
      result.taps.forEach(handleTap);
    }
    lastTapId = result.latest;
  } catch {
    readerStatus.textContent =
      "Wristband reader: bridge offline. Start nfc/bridge/bridge.py.";
  } finally {
    isPollingTaps = false;
  }
}

function dismissTapAlert() {
  tapAlert.hidden = true;
  alertedRequestId = null;
  nearbyStatus.focus();
}

globalThis.addEventListener("storage", (event) => {
  if (
    event.key === requestStore.storageKey ||
    event.key === requestStore.availabilityKey ||
    event.key === tapRequestStore.storageKey
  ) {
    render();
  }
});

openRequestButton.addEventListener("click", toggleRequestDetails);
acceptRequestButton.addEventListener("click", acceptRequest);
availabilityToggle.addEventListener("click", toggleAvailability);
dismissTapAlertButton.addEventListener("click", dismissTapAlert);
clearTapRequestsButton.addEventListener("click", clearTapRequests);
render();
pollTaps();
setInterval(pollTaps, tapPollInterval);

function renderOverview(isAvailable) {
  const list = document.querySelector("#overview-list");
  if (!list) return;
  const requests = tapRequestStore.getTapRequestsByDistance().map(request => ({...request, source: "wristband"}));
  const web = requestStore.getRequest();
  if (web && web.status !== "cancelled") requests.push({...web, source: "web", location: web.approximateLocation});
  requests.sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  let next = Math.max(0, ...Object.values(overviewNumbers).filter(Number.isFinite));
  requests.forEach(request => {
    if (!Number.isInteger(overviewNumbers[request.id])) overviewNumbers[request.id] = ++next;
    request.number = overviewNumbers[request.id];
    request.label = "Request " + request.number;
  });
  try { localStorage.setItem("linked.overview-numbers.v1", JSON.stringify(overviewNumbers)); } catch {}
  if (!requests.some(request => request.id === selectedOverviewId)) selectedOverviewId = null;
  list.replaceChildren(...requests.map(request => {
    const item = document.createElement("li");
    item.className = "overview-request";
    item.dataset.selected = String(request.id === selectedOverviewId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "request-select";
    button.setAttribute("aria-expanded", String(request.id === selectedOverviewId));
    const number = document.createElement("span");
    number.className = "request-number";
    number.textContent = request.number;
    const text = document.createElement("span");
    text.textContent = request.label + " | " + (request.source === "web" ? "Web request" : "Wristband request");
    const meta = document.createElement("small");
    meta.textContent = (request.status === "accepted" ? "Accepted" : "Waiting") + " | " + (request.location ? "Location shared" : "No location shared");
    text.append(meta); button.append(number, text);
    button.addEventListener("click", () => { selectedOverviewId = selectedOverviewId === request.id ? null : request.id; renderOverview(isAvailable); });
    item.append(button);
    if (request.id === selectedOverviewId) {
      const details = document.createElement("div"); details.className = "overview-details";
      const description = document.createElement("p");
      description.textContent = "Received " + formatReceivedTime(request.createdAt) + ". " + (request.source === "wristband" ? "Wristband " + request.wristbandUid + ". " : "Help requested. ") + (request.location ? (request.location.label || "Approximate location shown on the map.") : "No location shared. This request can still be accepted.");
      details.append(description);
      if (request.status === "accepted") {
        const confirmation = document.createElement("p");
        confirmation.textContent = "Accepted. The requester has been notified that a volunteer is on the way.";
        details.append(confirmation);
      }
      if (request.status === "pending") {
        const accept = document.createElement("button"); accept.type = "button"; accept.className = "primary"; accept.textContent = isAvailable ? "Accept request " + request.number : "Set yourself available to accept"; accept.disabled = !isAvailable;
        accept.addEventListener("click", () => { if (request.source === "web") acceptRequest(); else acceptTapRequest(request.id); });
        details.append(accept);
      }
      item.append(details);
    }
    return item;
  }));
  document.querySelector("#overview-empty").hidden = requests.length !== 0;
  document.querySelector("#overview-status").textContent = requests.length + " requests | " + requests.filter(r => r.status === "pending").length + " waiting | " + requests.filter(r => r.location).length + " on the map";
  requestMap.update(requestsMap, tapRequestStore.volunteerLocation, requests.filter(r => r.location), id => {
    selectedOverviewId = id;
    renderOverview(isAvailable);
    const index = requests.findIndex(r => r.id === id);
    const button = list.children[index]?.children[0];
    button?.focus();
    button?.scrollIntoView?.({block: "nearest", behavior: "smooth"});
  }, selectedOverviewId);
}

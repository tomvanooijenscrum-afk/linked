const requestButton = document.querySelector("#request-button");
const requestButtonLabel = document.querySelector("#request-button-label");
const cancelButton = document.querySelector("#cancel-button");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");
const shareLocation = document.querySelector("#share-location");
const locationChoiceState = document.querySelector("#location-choice-state");
const locationFeedback = document.querySelector("#location-feedback");
const locationWithoutButton = document.querySelector("#location-without-button");
const requestLocationPreview = document.querySelector(
  "#request-location-preview",
);
const requestLocationMap = document.querySelector("#request-location-map");
const requestLocationLabel = document.querySelector("#request-location-label");
const soundToggle = document.querySelector("#sound-toggle");
const soundToggleLabel = document.querySelector("#sound-toggle-label");
const requestStore = globalThis.LinkedRequestStore;

let activeRequest = requestStore.getRequest();
let requestStatus = getStatusFromRequest(activeRequest);
let receiptTimer = null;

let requestNumber = 0;
let locationAttempt = 0;
let locationPending = false;
const receiptDelay = 1500;

function getLocationFeedback(request) {
  if (request && request.approximateLocation) {
    return request.status === "accepted"
      ? "Approximate area shared with your volunteer."
      : "Approximate area ready to share after acceptance.";
  }
  return request && request.status === "accepted"
    ? "No location was shared for this request."
    : "Location sharing is off.";
}

function getApproximateLabel(properties) {
  const street = properties.street;
  const area =
    properties.neighbourhood ||
    properties.suburb ||
    properties.district ||
    properties.quarter;
  const city =
    properties.city ||
    properties.town ||
    properties.village ||
    properties.municipality;

  if (street) {
    const parts = [street, area, city].filter(
      (part, index, list) => part && list.indexOf(part) === index,
    );
    return `Near ${parts.join(", ")}`;
  }
  if (area && city && area !== city) {
    return `Near ${area}, ${city}`;
  }
  if (city) {
    return `Near ${city}`;
  }
  if (area) {
    return `Near ${area}`;
  }
  return "Approximate location available";
}

function renderLocationPreview(location) {
  const hasLocation = Boolean(location);
  requestLocationPreview.hidden = !hasLocation;
  requestStoreMap(location);
  if (!hasLocation) {
    requestLocationLabel.textContent = "Approximate location available";
    return;
  }

  requestLocationLabel.textContent =
    location.label || "Approximate location available";
}

function requestStoreMap(location) {
  globalThis.LinkedApproximateMap.update(requestLocationMap, location);
}

async function resolveApproximateLocationLabel(requestId, attempt, location) {
  if (typeof globalThis.fetch !== "function") {
    return;
  }

  const query = new URLSearchParams({
    lon: String(location.longitude),
    lat: String(location.latitude),
  });

  try {
    const response = await globalThis.fetch(
      `https://photon.komoot.io/reverse?${query.toString()}`,
      { referrerPolicy: "no-referrer" },
    );
    if (!response.ok) {
      return;
    }

    const result = await response.json();
    const properties = result.features?.[0]?.properties;
    if (!properties || !isCurrentLocationAttempt(requestId, attempt)) {
      return;
    }

    const label = getApproximateLabel(properties);
    if (label === "Approximate location available") {
      return;
    }

    const request = requestStore.setApproximateLocationLabel(requestId, label);
    if (!request) {
      return;
    }

    renderLocationPreview(request.approximateLocation);
  } catch {
    // Keep the map and generic label when the optional lookup is unavailable.
  }
}

locationFeedback.textContent = getLocationFeedback(activeRequest);
renderLocationPreview(activeRequest && activeRequest.approximateLocation);

const statusMessages = {
  idle: {
    title: "No active request",
    description: "You haven’t asked for help yet.",
  },
  sent: {
    title: "Request sent (demo)",
    description:
      "Waiting for a simulated receipt confirmation.",
  },
  received: {
    title: "Receipt simulated (demo)",
    description:
      "Your request is available to volunteers in this demo inbox.",
  },
  accepted: {
    title: "A volunteer is on the way",
    description:
      "Your request has been accepted. A volunteer is on the way.",
  },
  cancelled: {
    title: "Request cancelled",
    description:
      "Your request has stopped. You can ask for help again.",
  },
};

const sounds = {
  press: [[660, 0]],
  sent: [[520, 0.08], [780, 0.2]],
  received: [[660, 0], [880, 0.12], [1320, 0.24]],
  cancelled: [[520, 0.08], [330, 0.22]],
};

let soundEnabled = true;
let audioContext = null;

function playSound(name) {
  if (!soundEnabled) {
    return;
  }

  const AudioContextClass =
    globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  const now = audioContext.currentTime;
  for (const [frequency, start] of sounds[name]) {
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const begin = now + start;

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, begin);
    volume.gain.exponentialRampToValueAtTime(0.15, begin + 0.01);
    volume.gain.exponentialRampToValueAtTime(0.0001, begin + 0.18);
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start(begin);
    oscillator.stop(begin + 0.2);
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  playSound("press");
  render();
}

function isRequestActive() {
  return (
    requestStatus === "sent" ||
    requestStatus === "received" ||
    requestStatus === "accepted"
  );
}

function getStatusFromRequest(request) {
  if (!request) {
    return "idle";
  }
  if (request.status === "accepted" || request.status === "cancelled") {
    return request.status;
  }
  return "received";
}

function startRequest() {
  playSound("press");

  if (isRequestActive()) {
    return;
  }

  requestNumber += 1;
  locationAttempt += 1;
  const currentRequest = requestNumber;
  activeRequest = requestStore.createRequest();
  requestStatus = "sent";
  locationPending = shareLocation.checked;
  renderLocationPreview(activeRequest.approximateLocation);
  locationFeedback.textContent = shareLocation.checked
    ? "Waiting for location permission…"
    : "Location not shared. Your request was sent without it.";
  playSound("sent");
  render();

  if (shareLocation.checked) {
    requestLocation(activeRequest.id, locationAttempt);
  }

  receiptTimer = setTimeout(() => {
    if (
      currentRequest !== requestNumber ||
      requestStatus !== "sent"
    ) {
      return;
    }

    receiptTimer = null;
    requestStatus = "received";
    playSound("received");
    render();
  }, receiptDelay);

  cancelButton.focus();
}

function requestLocation(requestId, attempt) {
  const geolocation = globalThis.navigator && globalThis.navigator.geolocation;
  if (!geolocation) {
    locationPending = false;
    shareLocation.checked = false;
    locationFeedback.textContent =
      "Location isn’t available in this browser. Your request was still sent.";
    render();
    return;
  }

  geolocation.getCurrentPosition(
    (position) => {
      if (!isCurrentLocationAttempt(requestId, attempt)) {
        return;
      }

      locationPending = false;
      const request = requestStore.setApproximateLocation(requestId, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
      if (!request) {
        shareLocation.checked = false;
        locationFeedback.textContent =
          "Approximate location couldn’t be saved. Your request is still active.";
        render();
        return;
      }

      locationFeedback.textContent = getLocationFeedback(request);
      renderLocationPreview(request.approximateLocation);
      render();
      resolveApproximateLocationLabel(requestId, attempt, request.approximateLocation);
    },
    (error) => {
      if (!isCurrentLocationAttempt(requestId, attempt)) {
        return;
      }

      locationPending = false;
      shareLocation.checked = false;
      if (error.code === 1) {
        locationFeedback.textContent =
          "Location permission was denied. Your request was still sent without it.";
      } else if (error.code === 3) {
        locationFeedback.textContent =
          "Finding your location timed out. Your request was still sent without it.";
      } else {
        locationFeedback.textContent =
          "Your location couldn’t be found. Your request was still sent without it.";
      }
      render();
    },
    {
      enableHighAccuracy: false,
      maximumAge: 60000,
      timeout: 10000,
    },
  );
}

function continueWithoutLocation() {
  if (!locationPending || !isRequestActive()) {
    return;
  }

  locationAttempt += 1;
  locationPending = false;
  shareLocation.checked = false;
  locationFeedback.textContent =
    "Location sharing was stopped. Your request is still active without it.";
  render();
}

function isCurrentLocationAttempt(requestId, attempt) {
  return (
    attempt === locationAttempt &&
    activeRequest &&
    activeRequest.id === requestId &&
    isRequestActive()
  );
}

function cancelRequest() {
  playSound("press");

  if (!isRequestActive()) {
    return;
  }

  clearTimeout(receiptTimer);
  receiptTimer = null;
  requestNumber += 1;
  locationAttempt += 1;
  locationPending = false;
  shareLocation.checked = false;
  locationFeedback.textContent =
    "Location sharing was stopped. No location was saved.";
  const cancelledRequest = requestStore.cancelRequest(activeRequest.id);
  if (!cancelledRequest) {
    activeRequest = requestStore.getRequest();
    requestStatus = getStatusFromRequest(activeRequest);
    locationFeedback.textContent = getLocationFeedback(activeRequest);
    renderLocationPreview(
      activeRequest && activeRequest.approximateLocation,
    );
    render();
    return;
  }
  activeRequest = cancelledRequest;
  requestStatus = getStatusFromRequest(activeRequest);
  renderLocationPreview(activeRequest.approximateLocation);
  playSound("cancelled");
  render();

  requestButton.focus();
}

function render() {
  const active = isRequestActive();
  const message = statusMessages[requestStatus];

  statusTitle.textContent = message.title;
  statusDescription.textContent = message.description;
  requestButton.hidden = active;
  requestButton.disabled = active;
  cancelButton.hidden = !active;
  cancelButton.disabled = !active;
  shareLocation.disabled = active;
  locationWithoutButton.hidden = !locationPending;
  locationChoiceState.textContent = shareLocation.checked ? "ON" : "OFF";
  requestButtonLabel.textContent = requestStatus === "cancelled"
    ? "Ask for help again"
    : "Ask for help";

  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggleLabel.textContent = soundEnabled ? "Sound on" : "Sound off";
}

globalThis.addEventListener("storage", (event) => {
  if (event.key !== requestStore.storageKey) {
    return;
  }

  clearTimeout(receiptTimer);
  receiptTimer = null;
  requestNumber += 1;
  const previousRequestId = activeRequest && activeRequest.id;
  activeRequest = requestStore.getRequest();
  requestStatus = getStatusFromRequest(activeRequest);
  locationFeedback.textContent = getLocationFeedback(activeRequest);
  renderLocationPreview(
    activeRequest && activeRequest.approximateLocation,
  );
  if (
    !activeRequest ||
    activeRequest.id !== previousRequestId ||
    requestStatus === "cancelled"
  ) {
    locationAttempt += 1;
    locationPending = false;
    shareLocation.checked = false;
  }
  render();
});

requestButton.addEventListener("click", startRequest);
cancelButton.addEventListener("click", cancelRequest);
locationWithoutButton.addEventListener("click", continueWithoutLocation);
shareLocation.addEventListener("change", () => {
  locationFeedback.textContent = shareLocation.checked
    ? "Your browser will ask for permission after you ask for help."
    : "Location sharing is off.";
  render();
});
soundToggle.addEventListener("click", toggleSound);
render();

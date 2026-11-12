const requestButton = document.querySelector("#request-button");
const requestButtonLabel = document.querySelector("#request-button-label");
const cancelButton = document.querySelector("#cancel-button");
const requestStatusPanel = document.querySelector("#request-status");
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
const languageSelect = document.querySelector("#language-select");
const requestStore = globalThis.LinkedRequestStore;
const i18n = globalThis.LinkedI18n;
const t = i18n.t;

let activeRequest = requestStore.getRequest();
let requestStatus = getStatusFromRequest(activeRequest);
let receiptTimer = null;

let requestNumber = 0;
let locationAttempt = 0;
let locationPending = false;
const receiptDelay = 1500;

// Returns a translation key, so the text can follow the selected language.
function getLocationFeedback(request) {
  if (request && request.approximateLocation) {
    return request.status === "accepted"
      ? "location.feedback.shared"
      : "location.feedback.ready";
  }
  return request && request.status === "accepted"
    ? "location.feedback.noneShared"
    : "location.feedback.off";
}

let locationFeedbackKey = getLocationFeedback(activeRequest);

function setLocationFeedback(key) {
  locationFeedbackKey = key;
  locationFeedback.textContent = t(key);
}

// Place names come from the map service; only the "Near" prefix is translated.
function getLocationLabelText(location) {
  const label = location && location.label;
  if (!label) {
    return t("location.labelDefault");
  }
  const match = /^Near (.+)$/.exec(label);
  return match ? t("location.near", { place: match[1] }) : label;
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
  requestLocationLabel.textContent = getLocationLabelText(location);
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

setLocationFeedback(locationFeedbackKey);
renderLocationPreview(activeRequest && activeRequest.approximateLocation);

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
  setLocationFeedback(
    shareLocation.checked
      ? "location.feedback.waiting"
      : "location.feedback.sentWithout",
  );
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
    setLocationFeedback("location.feedback.unsupported");
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
        setLocationFeedback("location.feedback.saveFailed");
        render();
        return;
      }

      setLocationFeedback(getLocationFeedback(request));
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
        setLocationFeedback("location.feedback.denied");
      } else if (error.code === 3) {
        setLocationFeedback("location.feedback.timeout");
      } else {
        setLocationFeedback("location.feedback.notFound");
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
  setLocationFeedback("location.feedback.stopped");
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
  setLocationFeedback("location.feedback.cancelled");
  const cancelledRequest = requestStore.cancelRequest(activeRequest.id);
  if (!cancelledRequest) {
    activeRequest = requestStore.getRequest();
    requestStatus = getStatusFromRequest(activeRequest);
    setLocationFeedback(getLocationFeedback(activeRequest));
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

  requestStatusPanel.hidden = requestStatus === "idle";
  statusTitle.textContent = t(`status.${requestStatus}.title`);
  statusDescription.textContent = t(`status.${requestStatus}.description`);
  requestButton.hidden = active;
  requestButton.disabled = active;
  cancelButton.hidden = !active;
  cancelButton.disabled = !active;
  shareLocation.disabled = active;
  locationWithoutButton.hidden = !locationPending;
  locationChoiceState.textContent = t(
    shareLocation.checked ? "location.state.on" : "location.state.off",
  );
  requestButtonLabel.textContent = t(
    requestStatus === "cancelled" ? "request.again" : "request.button",
  );

  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggleLabel.textContent = t(soundEnabled ? "sound.on" : "sound.off");
}

globalThis.addEventListener("storage", (event) => {
  if (event.key === i18n.storageKey) {
    i18n.reload();
    return;
  }
  if (event.key !== requestStore.storageKey) {
    return;
  }

  clearTimeout(receiptTimer);
  receiptTimer = null;
  requestNumber += 1;
  const previousRequestId = activeRequest && activeRequest.id;
  activeRequest = requestStore.getRequest();
  requestStatus = getStatusFromRequest(activeRequest);
  setLocationFeedback(getLocationFeedback(activeRequest));
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
  setLocationFeedback(
    shareLocation.checked
      ? "location.feedback.willAsk"
      : "location.feedback.off",
  );
  render();
});
soundToggle.addEventListener("click", toggleSound);

// Language switching only redraws text. It never touches the request, the
// timers, the location choice or the checkbox, so nothing is submitted,
// cancelled or duplicated.
function refreshLanguageText() {
  languageSelect.value = i18n.getLanguage();
  locationFeedback.textContent = t(locationFeedbackKey);
  const storedRequest = requestStore.getRequest();
  requestLocationLabel.textContent = getLocationLabelText(
    storedRequest && storedRequest.approximateLocation,
  );
  render();
}

i18n.onChange(refreshLanguageText);
languageSelect.addEventListener("change", () => {
  i18n.setLanguage(languageSelect.value);
});
languageSelect.value = i18n.getLanguage();
render();
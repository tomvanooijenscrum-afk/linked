// Hulppagina van de aanvrager. De aanvraag gaat naar de server, zodat
// vrijwilligers hem op elk apparaat zien; deze pagina volgt de status.
const requestButton = document.querySelector("#request-button");
const requestButtonLabel = document.querySelector("#request-button-label");
const cancelButton = document.querySelector("#cancel-button");
const statusBanner = document.querySelector("#request-status");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");
const requestMap = document.querySelector("#request-map");
const soundToggle = document.querySelector("#sound-toggle");
const soundToggleLabel = document.querySelector("#sound-toggle-label");
const requestStore = globalThis.LinkedRequestStore;
const api = globalThis.LinkedWristbandApi.createApi();

// Hoe vaak de pagina vraagt of een vrijwilliger heeft geaccepteerd.
const statusPollInterval = 3000;

let activeRequest = requestStore.getRequest();
let requestStatus = getStatusFromRequest(activeRequest);
let pollTimer = null;
let busy = false;
// Verhoogd bij elke nieuwe aanvraag of annulering: oude antwoorden negeren.
let generation = 0;

const statusMessages = {
  idle: {
    title: "No active request",
    description: "Tap the button when you need someone.",
  },
  sending: {
    title: "Sending your request…",
    description: "One moment.",
  },
  received: {
    title: "Request sent",
    description: "Volunteers nearby can see it. We’ll show you when one is coming.",
  },
  accepted: {
    title: "A volunteer is on the way",
    description: "Someone accepted your request and is coming to you.",
  },
  cancelled: {
    title: "Request cancelled",
    description: "You can ask again anytime.",
  },
  failed: {
    title: "Your request could not be sent",
    description: "Check your connection and try again. Emergency? Call 112.",
  },
  cancelFailed: {
    title: "Could not cancel yet",
    description: "Your request is still open. Check your connection and try again.",
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
    requestStatus === "sending" ||
    requestStatus === "received" ||
    requestStatus === "accepted" ||
    requestStatus === "cancelFailed"
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

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

// Alleen een wachtende aanvraag hoeft gevolgd te worden.
function schedulePoll() {
  stopPolling();
  if (activeRequest?.status === "pending") {
    pollTimer = setTimeout(pollStatus, statusPollInterval);
  }
}

function applyServerRequest(serverRequest) {
  const wasAccepted = activeRequest?.status === "accepted";
  activeRequest = requestStore.saveRequest(serverRequest, activeRequest.secret);
  requestStatus = getStatusFromRequest(activeRequest);
  if (!wasAccepted && requestStatus === "accepted") {
    playSound("received");
    // Alleen bij de overgang naar geaccepteerd, niet na herladen.
    globalThis.LinkedConfetti?.fire(statusTitle);
  }
}

async function pollStatus() {
  pollTimer = null;
  if (!activeRequest) {
    return;
  }

  const current = generation;
  const result = await api.helpRequestStatus(activeRequest.id, activeRequest.secret);
  if (current !== generation || !activeRequest) {
    return;
  }

  if (result.ok) {
    applyServerRequest(result.request);
    render();
  } else if (result.httpStatus === 404) {
    // Niet meer op de server (bijvoorbeeld opgeruimd na een demo).
    requestStore.clearRequest();
    activeRequest = null;
    requestStatus = "idle";
    render();
    return;
  }
  // Bij een netwerkfout gewoon later opnieuw proberen.
  schedulePoll();
}

async function startRequest() {
  playSound("press");

  if (isRequestActive() || busy) {
    return;
  }

  busy = true;
  generation += 1;
  const current = generation;
  stopPolling();
  requestStatus = "sending";
  render();
  cancelButton.focus();

  const token = globalThis.LinkedWristbandTap?.token ?? null;
  const result = await api.createHelpRequest({ token });
  busy = false;
  if (current !== generation) {
    return;
  }

  if (!result.ok) {
    requestStatus = "failed";
    render();
    requestButton.focus();
    return;
  }

  activeRequest = requestStore.saveRequest(result.request, result.secret);
  requestStatus = getStatusFromRequest(activeRequest);
  playSound("sent");
  render();
  schedulePoll();
}

async function cancelRequest() {
  playSound("press");

  if (!isRequestActive() || !activeRequest || busy) {
    return;
  }

  busy = true;
  generation += 1;
  const current = generation;
  stopPolling();
  cancelButton.disabled = true;

  const result = await api.cancelHelpRequest(activeRequest.id, activeRequest.secret);
  busy = false;
  if (current !== generation) {
    return;
  }

  if (result.ok) {
    applyServerRequest(result.request);
    playSound("cancelled");
    render();
    requestButton.focus();
    return;
  }

  if (result.httpStatus === 404) {
    requestStore.clearRequest();
    activeRequest = null;
    requestStatus = "cancelled";
  } else {
    requestStatus = "cancelFailed";
    schedulePoll();
  }
  render();
}

function render() {
  const active = isRequestActive();
  const message = statusMessages[requestStatus];

  statusBanner.dataset.status = requestStatus;
  statusTitle.textContent = message.title;
  statusDescription.textContent = message.description;
  requestButton.hidden = active;
  requestButton.disabled = active || busy;
  cancelButton.hidden = !active;
  cancelButton.disabled = !active || busy || requestStatus === "sending";
  requestButtonLabel.textContent =
    requestStatus === "cancelled" || requestStatus === "failed"
      ? requestStatus === "failed"
        ? "Try again"
        : "Ask for help again"
      : "Ask for help";

  requestMap.dataset.status =
    requestStatus === "accepted" || requestStatus === "cancelFailed"
      ? "received"
      : requestStatus === "sending"
        ? "sent"
        : requestStatus === "failed"
          ? "idle"
          : requestStatus;
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggleLabel.textContent = soundEnabled ? "Sound on" : "Sound off";
}

// Een ander tabblad op dit apparaat heeft de aanvraag gewijzigd.
globalThis.addEventListener("storage", (event) => {
  if (event.key !== requestStore.storageKey) {
    return;
  }

  generation += 1;
  activeRequest = requestStore.getRequest();
  requestStatus = getStatusFromRequest(activeRequest);
  render();
  schedulePoll();
});

requestButton.addEventListener("click", startRequest);
cancelButton.addEventListener("click", cancelRequest);
soundToggle.addEventListener("click", toggleSound);
render();
// Na herladen: direct de laatste stand van de server ophalen.
if (activeRequest && activeRequest.status !== "cancelled") {
  pollStatus();
}

const requestButton = document.querySelector("#request-button");
const requestButtonLabel = document.querySelector("#request-button-label");
const cancelButton = document.querySelector("#cancel-button");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");
const requestMap = document.querySelector("#request-map");
const soundToggle = document.querySelector("#sound-toggle");
const soundToggleLabel = document.querySelector("#sound-toggle-label");

let requestStatus = "idle";
let receiptTimer = null;

let requestNumber = 0;
const receiptDelay = 1500;

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
      "No real responder has received this request.",
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
  return requestStatus === "sent" || requestStatus === "received";
}

function startRequest() {
  playSound("press");

  if (isRequestActive()) {
    return;
  }

  requestNumber += 1;
  const currentRequest = requestNumber;
  requestStatus = "sent";
  playSound("sent");
  render();

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

function cancelRequest() {
  playSound("press");

  if (!isRequestActive()) {
    return;
  }

  clearTimeout(receiptTimer);
  receiptTimer = null;
  requestNumber += 1;
  requestStatus = "cancelled";
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
  requestButtonLabel.textContent = requestStatus === "cancelled"
    ? "Ask for help again"
    : "Ask for help";

  requestMap.dataset.status = requestStatus;
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggleLabel.textContent = soundEnabled ? "Sound on" : "Sound off";
}

requestButton.addEventListener("click", startRequest);
cancelButton.addEventListener("click", cancelRequest);
soundToggle.addEventListener("click", toggleSound);
render();

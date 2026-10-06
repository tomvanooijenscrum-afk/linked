// Basisflow: klaar -> verzonden -> ontvangst gesimuleerd -> geannuleerd.
// Dit is alleen een lokale demo: geen netwerk, locatie of browseropslag.
// Dezelfde knoppen blijven in de HTML staan; render() werkt ze bij.
const requestButton = document.querySelector("#request-button");
const requestButtonLabel = document.querySelector("#request-button-label");
const cancelButton = document.querySelector("#cancel-button");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");
const requestMap = document.querySelector("#request-map");
const soundToggle = document.querySelector("#sound-toggle");
const soundToggleLabel = document.querySelector("#sound-toggle-label");

// Er is één status, dus we maken geen lijst met gelijktijdige verzoeken.
let requestStatus = "idle";
let receiptTimer = null;

// Een teller herkent callbacks van een oud, inmiddels geannuleerd verzoek.
// Dat voorkomt dat een oude timer een nieuw verzoek kan bevestigen.
let requestNumber = 0;
const receiptDelay = 1500;

// Teksten onderscheiden verzenden van ontvangen en noemen steeds de demo.
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

// Geluid wordt in de browser opgewekt met de Web Audio API.
// Geen audiobestanden of netwerk nodig. Elke toon: [frequentie, start].
// Starttijden in seconden, zodat geen extra timers nodig zijn.
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

  // Browsers zonder Web Audio (of de test) blijven gewoon werken.
  const AudioContextClass =
    globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  // Pas aanmaken na een klik: browsers blokkeren geluid daarvoor.
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

    // Kort en zacht: snel aanzwellen en uitsterven voorkomt klikjes.
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

// Verzonden en gesimuleerd ontvangen zijn allebei actieve statussen.
function isRequestActive() {
  return requestStatus === "sent" || requestStatus === "received";
}

function startRequest() {
  playSound("press");

  // Niet alleen de knop, maar ook deze controle blokkeert dubbel klikken.
  if (isRequestActive()) {
    return;
  }

  requestNumber += 1;
  const currentRequest = requestNumber;
  requestStatus = "sent";
  playSound("sent");
  render();

  // Deze timer vervangt alleen voor deze fase een ontvangende kant.
  // Er wordt niets naar een server of hulpverlener gestuurd.
  receiptTimer = setTimeout(() => {
    // Een callback mag alleen zijn eigen nog actieve verzoek bevestigen.
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

  // De aanvraagknop wordt verborgen. Verplaats focus naar annuleren,
  // zodat toetsenbordgebruikers de actieve flow kunnen blijven bedienen.
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

  // Na annuleren kan de gebruiker direct een nieuw verzoek starten.
  requestButton.focus();
}

function render() {
  const active = isRequestActive();
  const message = statusMessages[requestStatus];

  // textContent zet gewone tekst neer, zonder HTML uit te voeren.
  statusTitle.textContent = message.title;
  statusDescription.textContent = message.description;
  requestButton.hidden = active;
  requestButton.disabled = active;
  cancelButton.hidden = !active;
  cancelButton.disabled = !active;
  requestButtonLabel.textContent = requestStatus === "cancelled"
    ? "Ask for help again"
    : "Ask for help";

  // De kaart reageert via CSS op de huidige status.
  requestMap.dataset.status = requestStatus;
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggleLabel.textContent = soundEnabled ? "Sound on" : "Sound off";
}

// Koppel de vaste HTML-knoppen één keer aan hun functies en teken de start.
requestButton.addEventListener("click", startRequest);
cancelButton.addEventListener("click", cancelRequest);
soundToggle.addEventListener("click", toggleSound);
render();

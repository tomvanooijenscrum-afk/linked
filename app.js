// Basisflow: klaar -> verzonden -> ontvangst gesimuleerd -> geannuleerd.
// Dit is alleen een lokale demo: geen netwerk, locatie of browseropslag.
// Dezelfde knoppen blijven in de HTML staan; render() werkt ze bij.
const requestButton = document.querySelector("#request-button");
const requestButtonLabel = document.querySelector("#request-button-label");
const cancelButton = document.querySelector("#cancel-button");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");

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

// Verzonden en gesimuleerd ontvangen zijn allebei actieve statussen.
function isRequestActive() {
  return requestStatus === "sent" || requestStatus === "received";
}

function startRequest() {
  // Niet alleen de knop, maar ook deze controle blokkeert dubbel klikken.
  if (isRequestActive()) {
    return;
  }

  requestNumber += 1;
  const currentRequest = requestNumber;
  requestStatus = "sent";
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
    render();
  }, receiptDelay);

  // De aanvraagknop wordt verborgen. Verplaats focus naar annuleren,
  // zodat toetsenbordgebruikers de actieve flow kunnen blijven bedienen.
  cancelButton.focus();
}

function cancelRequest() {
  if (!isRequestActive()) {
    return;
  }

  clearTimeout(receiptTimer);
  receiptTimer = null;
  requestNumber += 1;
  requestStatus = "cancelled";
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
}

// Koppel de vaste HTML-knoppen één keer aan hun functies en teken de start.
requestButton.addEventListener("click", startRequest);
cancelButton.addEventListener("click", cancelRequest);
render();

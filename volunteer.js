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
const requestStore = globalThis.LinkedRequestStore;

let currentRequest = null;

function formatReceivedTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function render() {
  currentRequest = requestStore.getRequest();
  const isAvailable = requestStore.getAvailability() === "available";
  const isPending = currentRequest?.status === "pending";
  const isAccepted = currentRequest?.status === "accepted";
  // Een wachtend verzoek blijft bewaard, maar is alleen zichtbaar
  // als de vrijwilliger beschikbaar is.
  const showPending = isPending && isAvailable;

  availabilityCard.dataset.state = isAvailable ? "available" : "unavailable";
  availabilityToggle.setAttribute("aria-checked", String(isAvailable));
  availabilityValue.textContent = isAvailable ? "Available" : "Unavailable";
  availabilityHint.textContent = isAvailable
    ? "New requests appear in your inbox."
    : "New requests are paused and not shown in your inbox.";
  pendingRequestCard.hidden = !showPending;
  acceptedRequestCard.hidden = !isAccepted;
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

globalThis.addEventListener("storage", (event) => {
  if (
    event.key === requestStore.storageKey ||
    event.key === requestStore.availabilityKey
  ) {
    render();
  }
});

openRequestButton.addEventListener("click", toggleRequestDetails);
acceptRequestButton.addEventListener("click", acceptRequest);
availabilityToggle.addEventListener("click", toggleAvailability);
render();

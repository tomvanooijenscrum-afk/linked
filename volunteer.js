const inboxStatus = document.querySelector("#inbox-status");
const pendingRequestCard = document.querySelector("#pending-request");
const acceptedRequestCard = document.querySelector("#accepted-request");
const emptyState = document.querySelector("#empty-state");
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
  const isPending = currentRequest?.status === "pending";
  const isAccepted = currentRequest?.status === "accepted";

  pendingRequestCard.hidden = !isPending;
  acceptedRequestCard.hidden = !isAccepted;
  emptyState.hidden = isPending || isAccepted;

  if (isPending) {
    inboxStatus.textContent = "A new request is waiting for a volunteer.";
    requestReceived.textContent =
      `Received ${formatReceivedTime(currentRequest.createdAt)}`;
  } else if (isAccepted) {
    inboxStatus.textContent = "This request has been accepted.";
  } else {
    inboxStatus.textContent = "No pending requests right now.";
  }

  if (!isPending) {
    requestDetails.hidden = true;
    openRequestButton.setAttribute("aria-expanded", "false");
  }
  acceptRequestButton.disabled = !isPending;
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
  if (!currentRequest || currentRequest.status !== "pending") {
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
  if (event.key === requestStore.storageKey) {
    render();
  }
});

openRequestButton.addEventListener("click", toggleRequestDetails);
acceptRequestButton.addEventListener("click", acceptRequest);
render();

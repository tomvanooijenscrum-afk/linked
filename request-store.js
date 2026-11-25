// Lokaal geheugen van dit apparaat. De aanvraag zelf staat op de server
// (zie server/help_requests.py); hier staat alleen welke aanvraag van deze
// aanvrager is, met het geheim om de status te volgen of te annuleren.
// Daarnaast de beschikbaarheid van de vrijwilliger op dit apparaat.
((global) => {
  const storageKey = "linked.help-request.v2";
  const availabilityKey = "linked.volunteer-availability.v1";
  const validStatuses = new Set(["pending", "accepted", "cancelled"]);
  const validAvailability = new Set(["available", "unavailable"]);

  function getAvailability() {
    let status;
    try {
      status = global.localStorage.getItem(availabilityKey);
    } catch (error) {
      console.error("Could not read the saved volunteer availability.", error);
      return "available";
    }

    return validAvailability.has(status) ? status : "available";
  }

  function setAvailability(status) {
    if (!validAvailability.has(status)) {
      return null;
    }

    global.localStorage.setItem(availabilityKey, status);
    return status;
  }

  function isValidRequest(request) {
    return (
      request !== null &&
      typeof request === "object" &&
      typeof request.id === "string" &&
      typeof request.secret === "string" &&
      validStatuses.has(request.status)
    );
  }

  function getRequest() {
    let stored;
    try {
      stored = global.localStorage.getItem(storageKey);
    } catch (error) {
      console.error("Could not read the saved help request.", error);
      return null;
    }
    if (stored === null) {
      return null;
    }

    let request;
    try {
      request = JSON.parse(stored);
    } catch (error) {
      console.error("Could not read the saved help request.", error);
      return null;
    }

    if (!isValidRequest(request)) {
      console.error("The saved help request has an invalid format.");
      return null;
    }

    return request;
  }

  // serverRequest: { id, status, createdAt, acceptedAt } van de API.
  function saveRequest(serverRequest, secret) {
    const request = {
      id: serverRequest.id,
      secret,
      status: serverRequest.status,
      createdAt: serverRequest.createdAt ?? null,
      acceptedAt: serverRequest.acceptedAt ?? null,
    };
    if (!isValidRequest(request)) {
      return null;
    }
    global.localStorage.setItem(storageKey, JSON.stringify(request));
    return request;
  }

  function clearRequest() {
    global.localStorage.removeItem(storageKey);
  }

  global.LinkedRequestStore = Object.freeze({
    storageKey,
    availabilityKey,
    getRequest,
    saveRequest,
    clearRequest,
    getAvailability,
    setAvailability,
  });
})(globalThis);

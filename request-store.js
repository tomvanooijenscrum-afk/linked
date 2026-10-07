((global) => {
  const storageKey = "linked.help-request.v1";
  const validStatuses = new Set(["pending", "accepted", "cancelled"]);

  function isValidRequest(request) {
    return (
      request !== null &&
      typeof request === "object" &&
      typeof request.id === "string" &&
      validStatuses.has(request.status) &&
      Number.isFinite(request.createdAt) &&
      (request.acceptedAt === null || Number.isFinite(request.acceptedAt))
    );
  }

  function getRequest() {
    const storedRequest = global.localStorage.getItem(storageKey);
    if (storedRequest === null) {
      return null;
    }

    let request;
    try {
      request = JSON.parse(storedRequest);
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

  function saveRequest(request) {
    global.localStorage.setItem(storageKey, JSON.stringify(request));
    return request;
  }

  function createRequest() {
    const request = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      status: "pending",
      createdAt: Date.now(),
      acceptedAt: null,
    };
    return saveRequest(request);
  }

  function acceptRequest(requestId) {
    const request = getRequest();
    if (
      !request ||
      request.id !== requestId ||
      request.status !== "pending"
    ) {
      return null;
    }

    return saveRequest({
      ...request,
      status: "accepted",
      acceptedAt: Date.now(),
    });
  }

  function cancelRequest(requestId) {
    const request = getRequest();
    if (
      !request ||
      request.id !== requestId ||
      (request.status !== "pending" && request.status !== "accepted")
    ) {
      return null;
    }

    return saveRequest({ ...request, status: "cancelled" });
  }

  global.LinkedRequestStore = Object.freeze({
    storageKey,
    getRequest,
    createRequest,
    acceptRequest,
    cancelRequest,
  });
})(globalThis);

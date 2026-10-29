((global) => {
  const storageKey = "linked.help-request.v1";
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
      validStatuses.has(request.status) &&
      Number.isFinite(request.createdAt) &&
      (request.acceptedAt === null || Number.isFinite(request.acceptedAt)) &&
      (request.approximateLocation === undefined ||
        request.approximateLocation === null ||
        isValidApproximateLocation(request.approximateLocation))
    );
  }

  function isValidApproximateLocation(location) {
    return (
      location !== null &&
      typeof location === "object" &&
      Number.isFinite(location.latitude) &&
      location.latitude >= -90 &&
      location.latitude <= 90 &&
      Number.isFinite(location.longitude) &&
      location.longitude >= -180 &&
      location.longitude <= 180 &&
      location.latitude === roundCoordinate(location.latitude) &&
      location.longitude === roundCoordinate(location.longitude) &&
      (location.radiusMeters === undefined ||
        (Number.isFinite(location.radiusMeters) &&
          location.radiusMeters >= 500 &&
          location.radiusMeters <= 1000000)) &&
      (location.label === undefined ||
        (typeof location.label === "string" &&
          location.label.length <= 120))
    );
  }

  function roundCoordinate(coordinate) {
    return Math.round(coordinate * 100) / 100;
  }

  function getApproximateRadiusMeters(latitude, accuracyMeters = 0) {
    const halfCellLatitude = 0.005 * 111320;
    const halfCellLongitude =
      halfCellLatitude * Math.cos((latitude * Math.PI) / 180);
    const roundingRadius = Math.sqrt(
      halfCellLatitude ** 2 + halfCellLongitude ** 2,
    );
    const accuracy = Number.isFinite(accuracyMeters)
      ? Math.max(0, accuracyMeters)
      : 0;

    // Include the rounding cell's half-diagonal and browser-reported accuracy.
    return Math.ceil((roundingRadius + accuracy) / 50) * 50;
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
      approximateLocation: null,
    };
    return saveRequest(request);
  }

  function setApproximateLocation(requestId, coordinates) {
    if (
      !coordinates ||
      !Number.isFinite(coordinates.latitude) ||
      coordinates.latitude < -90 ||
      coordinates.latitude > 90 ||
      !Number.isFinite(coordinates.longitude) ||
      coordinates.longitude < -180 ||
      coordinates.longitude > 180
    ) {
      return null;
    }

    const request = getRequest();
    if (
      !request ||
      request.id !== requestId ||
      (request.status !== "pending" && request.status !== "accepted")
    ) {
      return null;
    }

    const latitude = roundCoordinate(coordinates.latitude);
    const longitude = roundCoordinate(coordinates.longitude);
    return saveRequest({
      ...request,
      approximateLocation: {
        // Two decimals describe an area, not the browser's precise location.
        latitude,
        longitude,
        radiusMeters: getApproximateRadiusMeters(
          latitude,
          coordinates.accuracy,
        ),
      },
    });
  }

  function setApproximateLocationLabel(requestId, label) {
    if (typeof label !== "string" || label.length === 0 || label.length > 120) {
      return null;
    }

    const request = getRequest();
    if (
      !request ||
      request.id !== requestId ||
      !request.approximateLocation ||
      (request.status !== "pending" && request.status !== "accepted")
    ) {
      return null;
    }

    return saveRequest({
      ...request,
      approximateLocation: {
        ...request.approximateLocation,
        label,
      },
    });
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

    return saveRequest({
      ...request,
      status: "cancelled",
      approximateLocation: null,
    });
  }

  global.LinkedRequestStore = Object.freeze({
    storageKey,
    availabilityKey,
    getRequest,
    createRequest,
    setApproximateLocation,
    setApproximateLocationLabel,
    getApproximateRadiusMeters,
    acceptRequest,
    cancelRequest,
    getAvailability,
    setAvailability,
  });
})(globalThis);

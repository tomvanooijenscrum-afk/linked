((global) => {
  const storageKey = "linked.tap-requests.v1";
  const validStatuses = new Set(["pending", "accepted"]);
  const maxRequests = 20;
  // Alle locaties zijn hypothetisch en alleen voor de demonstratie:
  // de vrijwilliger staat vast bij Fontys Rachelsmolen in Eindhoven.
  const volunteerLocation = Object.freeze({
    latitude: 51.4516,
    longitude: 5.4816,
    label: "Your demo position (Fontys Rachelsmolen)",
  });
  const minDistanceMeters = 300;
  const maxDistanceMeters = 3000;
  const metersPerDegree = 111320;

  function randomFraction() {
    const values = new Uint32Array(1);
    global.crypto.getRandomValues(values);
    return values[0] / 2 ** 32;
  }

  // Een willekeurig punt op 0,3–3 km van de vrijwilliger.
  function simulateLocation() {
    const angle = randomFraction() * 2 * Math.PI;
    const distance =
      minDistanceMeters +
      randomFraction() * (maxDistanceMeters - minDistanceMeters);
    const latitudeRadians = (volunteerLocation.latitude * Math.PI) / 180;
    return {
      latitude:
        volunteerLocation.latitude +
        (distance * Math.cos(angle)) / metersPerDegree,
      longitude:
        volunteerLocation.longitude +
        (distance * Math.sin(angle)) /
          (metersPerDegree * Math.cos(latitudeRadians)),
    };
  }

  // Haversine: afstand in meters over het aardoppervlak.
  function distanceMeters(from, to) {
    const radius = 6371000;
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const deltaLatitude = toRadians(to.latitude - from.latitude);
    const deltaLongitude = toRadians(to.longitude - from.longitude);
    const a =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(toRadians(from.latitude)) *
        Math.cos(toRadians(to.latitude)) *
        Math.sin(deltaLongitude / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(a));
  }

  function isValidLocation(location) {
    return (
      location !== null &&
      typeof location === "object" &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude)
    );
  }

  function isValidTapRequest(request) {
    return (
      request !== null &&
      typeof request === "object" &&
      typeof request.id === "string" &&
      typeof request.wristbandUid === "string" &&
      validStatuses.has(request.status) &&
      Number.isFinite(request.createdAt) &&
      (request.acceptedAt === null || Number.isFinite(request.acceptedAt)) &&
      isValidLocation(request.location)
    );
  }

  function getTapRequests() {
    let stored;
    try {
      stored = global.localStorage.getItem(storageKey);
    } catch (error) {
      console.error("Could not read the saved wristband requests.", error);
      return [];
    }
    if (stored === null) {
      return [];
    }

    let requests;
    try {
      requests = JSON.parse(stored);
    } catch (error) {
      console.error("Could not read the saved wristband requests.", error);
      return [];
    }

    if (!Array.isArray(requests)) {
      console.error("The saved wristband requests have an invalid format.");
      return [];
    }

    return requests.filter(isValidTapRequest);
  }

  function saveTapRequests(requests) {
    global.localStorage.setItem(
      storageKey,
      JSON.stringify(requests.slice(-maxRequests)),
    );
  }

  // Elke tik telt als een nieuw persoon die hulp nodig heeft.
  function createTapRequest(wristbandUid) {
    if (typeof wristbandUid !== "string" || wristbandUid.length === 0) {
      return null;
    }

    const request = {
      id: `tap-${Date.now().toString(36)}-${randomFraction()
        .toString(36)
        .slice(2, 8)}`,
      wristbandUid,
      status: "pending",
      createdAt: Date.now(),
      acceptedAt: null,
      location: simulateLocation(),
    };
    saveTapRequests([...getTapRequests(), request]);
    return request;
  }

  function acceptTapRequest(requestId) {
    const requests = getTapRequests();
    const index = requests.findIndex((request) => request.id === requestId);
    if (index === -1 || requests[index].status !== "pending") {
      return null;
    }

    requests[index] = {
      ...requests[index],
      status: "accepted",
      acceptedAt: Date.now(),
    };
    saveTapRequests(requests);
    return requests[index];
  }

  function clearTapRequests() {
    global.localStorage.setItem(storageKey, "[]");
  }

  // Dichtstbijzijnde verzoek eerst.
  function getTapRequestsByDistance() {
    return getTapRequests()
      .map((request) => ({
        ...request,
        distanceMeters: distanceMeters(volunteerLocation, request.location),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  global.LinkedTapRequestStore = Object.freeze({
    storageKey,
    volunteerLocation,
    minDistanceMeters,
    maxDistanceMeters,
    distanceMeters,
    getTapRequests,
    getTapRequestsByDistance,
    createTapRequest,
    acceptTapRequest,
    clearTapRequests,
  });
})(globalThis);

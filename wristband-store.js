((global) => {
  const storageKey = "linked.wristbands.v1";
  const baseUrlKey = "linked.wristband-base-url.v1";
  const validStatuses = new Set(["pending", "active", "inactive"]);
  // De firmware past maximaal 40 tekens na "https://" op de tag.
  const maxUrlSuffix = 40;
  const tokenAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const tokenLength = 8;

  function readItem(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (error) {
      console.error("Could not read saved wristband data.", error);
      return null;
    }
  }

  function normaliseBaseUrl(url) {
    if (typeof url !== "string") {
      return null;
    }

    const trimmed = url.trim().replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(trimmed)) {
      return null;
    }

    return trimmed;
  }

  function getBaseUrl() {
    return normaliseBaseUrl(readItem(baseUrlKey));
  }

  function setBaseUrl(url) {
    const baseUrl = normaliseBaseUrl(url);
    if (!baseUrl || !isUrlFitting(buildUrl("x".repeat(tokenLength), baseUrl))) {
      return null;
    }

    global.localStorage.setItem(baseUrlKey, baseUrl);
    return baseUrl;
  }

  // Een query string werkt op elke statische host; /t/... vraagt een server.
  function buildUrl(token, baseUrl = getBaseUrl()) {
    return `${baseUrl}/?t=${token}`;
  }

  function isUrlFitting(url) {
    return (
      typeof url === "string" &&
      url.startsWith("https://") &&
      url.length - "https://".length <= maxUrlSuffix
    );
  }

  function createToken() {
    const bytes = new Uint8Array(tokenLength);
    global.crypto.getRandomValues(bytes);
    return Array.from(
      bytes,
      (byte) => tokenAlphabet[byte % tokenAlphabet.length],
    ).join("");
  }

  function isValidWristband(wristband) {
    return (
      wristband !== null &&
      typeof wristband === "object" &&
      typeof wristband.id === "string" &&
      typeof wristband.token === "string" &&
      typeof wristband.url === "string" &&
      validStatuses.has(wristband.status) &&
      (wristband.uid === null || typeof wristband.uid === "string") &&
      Number.isFinite(wristband.createdAt) &&
      (wristband.activatedAt === null || Number.isFinite(wristband.activatedAt))
    );
  }

  function getWristbands() {
    const stored = readItem(storageKey);
    if (stored === null) {
      return [];
    }

    let wristbands;
    try {
      wristbands = JSON.parse(stored);
    } catch (error) {
      console.error("Could not read the saved wristbands.", error);
      return [];
    }

    if (!Array.isArray(wristbands)) {
      console.error("The saved wristbands have an invalid format.");
      return [];
    }

    return wristbands.filter(isValidWristband);
  }

  function saveWristbands(wristbands) {
    global.localStorage.setItem(storageKey, JSON.stringify(wristbands));
    return wristbands;
  }

  function updateWristband(id, change) {
    const wristbands = getWristbands();
    const index = wristbands.findIndex((wristband) => wristband.id === id);
    if (index === -1) {
      return null;
    }

    const updated = change(wristbands[index]);
    if (!updated) {
      return null;
    }

    wristbands[index] = updated;
    saveWristbands(wristbands);
    return updated;
  }

  function createWristband() {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      return null;
    }

    const token = createToken();
    const wristband = {
      id: `wristband-${Date.now().toString(36)}-${token}`,
      token,
      url: buildUrl(token, baseUrl),
      status: "pending",
      uid: null,
      createdAt: Date.now(),
      activatedAt: null,
    };
    if (!isUrlFitting(wristband.url)) {
      return null;
    }

    saveWristbands([...getWristbands(), wristband]);
    return wristband;
  }

  // Alleen activeren als de teruggelezen URL precies klopt.
  function activateWristband(id, uid, verifiedUrl) {
    return updateWristband(id, (wristband) =>
      wristband.status === "pending" && wristband.url === verifiedUrl
        ? {
            ...wristband,
            status: "active",
            uid: typeof uid === "string" ? uid : null,
            activatedAt: Date.now(),
          }
        : null,
    );
  }

  function deactivateWristband(id) {
    return updateWristband(id, (wristband) =>
      wristband.status === "inactive"
        ? null
        : { ...wristband, status: "inactive" },
    );
  }

  global.LinkedWristbandStore = Object.freeze({
    storageKey,
    baseUrlKey,
    maxUrlSuffix,
    getBaseUrl,
    setBaseUrl,
    buildUrl,
    isUrlFitting,
    getWristbands,
    createWristband,
    activateWristband,
    deactivateWristband,
  });
})(globalThis);

// Client voor de beheerders-API van de Linked-backend (server/app.py).
// Elke aanroep geeft { ok, httpStatus, error?, ... } terug en gooit nooit.
// (httpStatus, niet status: /resolve heeft zelf een veld status.)
((global) => {
  async function call(path, { method = "GET", body, headers = {}, fetch = global.fetch } = {}) {
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          // Verplicht voor wijzigingen; zie protect_against_csrf in app.py.
          "X-Linked-Request": "1",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      console.error("Could not reach the Linked server.", error);
      return { ok: false, httpStatus: 0, error: "SERVER_OFFLINE" };
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object") {
      return { ok: false, httpStatus: response.status, error: "INVALID_RESPONSE" };
    }
    return { ...data, ok: response.ok && data.ok === true, httpStatus: response.status };
  }

  function createApi(options = {}) {
    const request = (path, init = {}) => call(path, { ...options, ...init });
    const post = (path, body = {}) => request(path, { method: "POST", body });
    const id = (wristbandId) => encodeURIComponent(wristbandId);
    // Het geheim van de aanvrager gaat in een header, nooit in de URL.
    const secretHeader = (secret) => ({ "X-Linked-Secret": secret });

    return Object.freeze({
      me: () => request("/api/auth/me"),
      login: (username, password) => post("/api/auth/login", { username, password }),
      logout: () => post("/api/auth/logout"),
      listEvents: () => request("/api/events"),
      createEvent: (name) => post("/api/events", { name }),
      listWristbands({ q = "", status = "all", eventId = "" } = {}) {
        const params = new URLSearchParams({ q, status });
        if (eventId !== "" && eventId !== null) params.set("eventId", eventId);
        return request(`/api/wristbands?${params}`);
      },
      lookup: (uid) => request(`/api/wristbands/lookup?uid=${encodeURIComponent(uid)}`),
      reserve: (uid, eventId = null) => post("/api/wristbands/reserve", { uid, eventId }),
      reportFailure: (wristbandId, stage, error) =>
        post(`/api/wristbands/${id(wristbandId)}/failure`, { stage, error }),
      confirm: (wristbandId, uid, url) =>
        post(`/api/wristbands/${id(wristbandId)}/confirm`, { uid, url }),
      activate: (wristbandId) => post(`/api/wristbands/${id(wristbandId)}/activate`),
      deactivate: (wristbandId) => post(`/api/wristbands/${id(wristbandId)}/deactivate`),
      discard: (wristbandId) =>
        request(`/api/wristbands/${id(wristbandId)}`, { method: "DELETE" }),
      resolve: (token) =>
        request(`/api/wristbands/resolve?t=${encodeURIComponent(token)}`),

      // Hulpaanvragen, gedeeld tussen alle apparaten.
      createHelpRequest: ({ token = null, tagUid = null } = {}) =>
        post("/api/help-requests", {
          ...(token ? { token } : {}),
          ...(tagUid ? { tagUid } : {}),
        }),
      helpRequestStatus: (requestId, secret) =>
        request(`/api/help-requests/${id(requestId)}`, { headers: secretHeader(secret) }),
      cancelHelpRequest: (requestId, secret) =>
        request(`/api/help-requests/${id(requestId)}/cancel`, {
          method: "POST",
          body: {},
          headers: secretHeader(secret),
        }),
      listHelpRequests: () => request("/api/help-requests"),
      acceptHelpRequest: (requestId) => post(`/api/help-requests/${id(requestId)}/accept`),
      clearHelpRequests: () => request("/api/help-requests", { method: "DELETE" }),
    });
  }

  global.LinkedWristbandApi = Object.freeze({ createApi });
})(globalThis);

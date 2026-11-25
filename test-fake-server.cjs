// Nep-backend voor de browsertests: zelfde regels als server/help_requests.py,
// met één gedeelde toestand voor meerdere "apparaten". Elk apparaat krijgt
// een eigen fetch met een eigen sessie, net als losse browsers.
const users = {
  helper: { username: "helper", role: "volunteer" },
  helper2: { username: "helper2", role: "volunteer" },
  admin: { username: "admin", role: "admin" },
};
const PASSWORD = "correct horse battery";

function createFakeServer() {
  const state = { requests: [], online: true, calls: [], nextId: 1, nextPoint: 0 };
  // Vaste punten op 0,3–3 km van de vrijwilliger (in volgorde uitgedeeld).
  const points = [
    { latitude: 51.4606, longitude: 5.4816 }, // ~1,0 km
    { latitude: 51.4546, longitude: 5.4816 }, // ~0,33 km
    { latitude: 51.4716, longitude: 5.4816 }, // ~2,2 km
  ];

  function reply(status, body) {
    return { ok: status < 400, status, json: async () => body };
  }

  function forVolunteer(request, session) {
    const { secret, ...rest } = request;
    return { ...rest, acceptedByMe: request.acceptedBy === session.user?.username };
  }

  function forRequester(request) {
    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      acceptedAt: request.acceptedAt,
    };
  }

  function device() {
    const session = { user: null };
    async function fetch(path, init = {}) {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : {};
      const headers = init.headers ?? {};
      state.calls.push({ method, path, body, headers });
      if (!state.online) throw new TypeError("Failed to fetch");
      if (method !== "GET" && headers["X-Linked-Request"] !== "1") {
        return reply(403, { ok: false, error: "CSRF_HEADER_MISSING" });
      }
      const isVolunteer = () => ["volunteer", "admin"].includes(session.user?.role);
      const needVolunteer = () =>
        session.user === null
          ? reply(401, { ok: false, error: "NOT_SIGNED_IN" })
          : reply(403, { ok: false, error: "FORBIDDEN" });

      if (path === "/api/auth/me") {
        return session.user
          ? reply(200, { ok: true, user: session.user })
          : reply(401, { ok: false, error: "NOT_SIGNED_IN" });
      }
      if (path === "/api/auth/login") {
        const found = users[body.username];
        if (!found || body.password !== PASSWORD) {
          return reply(401, { ok: false, error: "INVALID_CREDENTIALS" });
        }
        session.user = found;
        return reply(200, { ok: true, user: found });
      }
      if (path === "/api/auth/logout") {
        session.user = null;
        return reply(200, { ok: true });
      }

      if (path === "/api/help-requests" && method === "POST") {
        if (body.tagUid !== undefined && !isVolunteer()) return needVolunteer();
        const id = `req-${state.nextId++}`;
        const request = {
          id,
          secret: `secret-${id}`,
          status: "pending",
          source: body.tagUid ? "reader" : body.token === "active-token" ? "wristband" : "app",
          wristbandLabel: body.token === "active-token" ? "WB-0001" : null,
          eventName: body.token === "active-token" ? "Glow" : null,
          tagUid: body.tagUid ?? null,
          location: points[state.nextPoint++ % points.length],
          createdAt: new Date(Date.UTC(2026, 10, 26, 20, state.nextId)).toISOString(),
          acceptedAt: null,
          acceptedBy: null,
        };
        state.requests.push(request);
        return reply(201, { ok: true, request: forRequester(request), secret: request.secret });
      }
      if (path === "/api/help-requests" && method === "GET") {
        if (!isVolunteer()) return needVolunteer();
        const open = state.requests.filter((r) => r.status !== "cancelled");
        return reply(200, { ok: true, requests: open.map((r) => forVolunteer(r, session)) });
      }
      if (path === "/api/help-requests" && method === "DELETE") {
        if (session.user?.role !== "admin") return needVolunteer();
        const removed = state.requests.length;
        state.requests = [];
        return reply(200, { ok: true, removed });
      }

      const match = path.match(/^\/api\/help-requests\/([^/]+)(\/accept|\/cancel)?$/);
      if (match) {
        const request = state.requests.find((r) => r.id === decodeURIComponent(match[1]));
        if (match[2] === "/accept") {
          if (!isVolunteer()) return needVolunteer();
          if (!request) return reply(404, { ok: false, error: "NOT_FOUND" });
          if (request.status === "cancelled") {
            return reply(409, { ok: false, error: "REQUEST_CANCELLED" });
          }
          if (request.status === "accepted" && request.acceptedBy !== session.user.username) {
            return reply(409, { ok: false, error: "ALREADY_ACCEPTED" });
          }
          request.status = "accepted";
          request.acceptedBy = session.user.username;
          request.acceptedAt ??= "2026-11-26T21:00:00+00:00";
          return reply(200, { ok: true, request: forVolunteer(request, session) });
        }
        if (!request || headers["X-Linked-Secret"] !== request.secret) {
          return reply(404, { ok: false, error: "NOT_FOUND" });
        }
        if (match[2] === "/cancel") request.status = "cancelled";
        return reply(200, { ok: true, request: forRequester(request) });
      }
      return reply(404, { ok: false, error: "NOT_FOUND" });
    }
    return { fetch, session };
  }

  return { state, device, PASSWORD };
}

module.exports = { createFakeServer };

((global) => {
  // Zelfde Leaflet- en OpenStreetMap-opzet als de locatiekaart van US10.
  const tiles = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">' +
    "OpenStreetMap contributors</a>";
  const colors = {
    volunteer: "#183e37",
    pending: "#c58a2e",
    closest: "#b5461f",
    accepted: "#8aab54",
  };

  let state = null;

  function showUnavailable(element) {
    element.textContent =
      "Map unavailable. Map tiles need an internet connection.";
    element.dataset.mapState = "unavailable";
  }

  function createMap(leaflet, element, volunteer) {
    element.replaceChildren();
    const map = leaflet.map(element, { scrollWheelZoom: false });
    map.setView([volunteer.latitude, volunteer.longitude], 13);
    leaflet.tileLayer(tiles, { attribution, maxZoom: 19 }).addTo(map);
    leaflet
      .circleMarker([volunteer.latitude, volunteer.longitude], {
        radius: 10,
        color: "white",
        weight: 3,
        fillColor: colors.volunteer,
        fillOpacity: 1,
      })
      .bindTooltip(volunteer.label)
      .addTo(map);

    const layer = leaflet.layerGroup().addTo(map);
    if (typeof global.ResizeObserver === "function") {
      new global.ResizeObserver(() => map.invalidateSize()).observe(element);
    }
    return { map, layer };
  }

  // requests: gesorteerd op afstand, met distanceMeters en label.
  function update(element, volunteer, requests) {
    const leaflet = global.L;
    if (!leaflet) {
      showUnavailable(element);
      return;
    }

    if (!state) {
      state = createMap(leaflet, element, volunteer);
    }

    state.layer.clearLayers();
    const points = [[volunteer.latitude, volunteer.longitude]];
    requests.forEach((request, index) => {
      const isClosest = index === 0 && request.status === "pending";
      const color =
        request.status === "accepted"
          ? colors.accepted
          : isClosest
            ? colors.closest
            : colors.pending;
      const position = [request.location.latitude, request.location.longitude];
      leaflet
        .circleMarker(position, {
          radius: isClosest ? 11 : 8,
          color: "white",
          weight: 2,
          fillColor: color,
          fillOpacity: 0.95,
        })
        .bindTooltip(request.label)
        .addTo(state.layer);
      points.push(position);
    });

    element.dataset.mapState = "ready";
    state.map.invalidateSize();
    if (points.length > 1) {
      state.map.fitBounds(points, { padding: [28, 28], maxZoom: 15 });
    } else {
      state.map.setView(points[0], 14);
    }
  }

  global.LinkedRequestMap = Object.freeze({ update });
})(globalThis);

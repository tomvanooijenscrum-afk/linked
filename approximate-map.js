((global) => {
  const maps = new WeakMap();
  const leafletTiles = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">' +
    "OpenStreetMap contributors</a>";

  function getRadius(location) {
    return location.radiusMeters ||
      global.LinkedRequestStore.getApproximateRadiusMeters(
        location.latitude,
      );
  }

  function showUnavailable(element) {
    element.textContent = "Map preview unavailable.";
    element.dataset.mapState = "unavailable";
  }

  function update(element, location) {
    const leaflet = global.L;
    if (!leaflet) {
      showUnavailable(element);
      return;
    }

    let mapState = maps.get(element);
    if (!location) {
      if (mapState) {
        mapState.resizeObserver?.disconnect();
        mapState.map.remove();
        maps.delete(element);
      }
      element.replaceChildren();
      delete element.dataset.mapState;
      return;
    }

    if (!mapState) {
      element.replaceChildren();
      const map = leaflet.map(element, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
      });
      map.setView([location.latitude, location.longitude], 13);
      leaflet.tileLayer(leafletTiles, {
        attribution,
        maxZoom: 19,
      }).addTo(map);
      const circle = leaflet.circle(
        [location.latitude, location.longitude],
        {
          radius: getRadius(location),
          color: "#183e37",
          fillColor: "#8aab54",
          fillOpacity: 0.28,
          weight: 2,
        },
      ).addTo(map);

      mapState = { map, circle };
      maps.set(element, mapState);
      if (typeof global.ResizeObserver === "function") {
        mapState.resizeObserver = new global.ResizeObserver(() => {
          map.invalidateSize({ pan: false });
          map.fitBounds(circle.getBounds(), {
            padding: [16, 16],
            maxZoom: 15,
          });
        });
        mapState.resizeObserver.observe(element);
      }
    } else {
      mapState.circle.setLatLng([location.latitude, location.longitude]);
      mapState.circle.setRadius(getRadius(location));
    }

    element.dataset.mapState = "ready";
    mapState.map.invalidateSize({ pan: false });
    mapState.map.fitBounds(mapState.circle.getBounds(), {
      padding: [16, 16],
      maxZoom: 15,
    });
  }

  global.LinkedApproximateMap = Object.freeze({ update });
})(globalThis);

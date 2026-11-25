// Afstanden voor de vrijwilligerskaart. Alle locaties zijn hypothetisch:
// de vrijwilliger staat vast bij Fontys Rachelsmolen in Eindhoven en de
// server kiest voor elke aanvraag een willekeurig punt op 0,3–3 km.
((global) => {
  const volunteerLocation = Object.freeze({
    latitude: 51.4516,
    longitude: 5.4816,
    label: "Your demo position (Fontys Rachelsmolen)",
  });

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

  global.LinkedGeo = Object.freeze({ volunteerLocation, distanceMeters });
})(globalThis);

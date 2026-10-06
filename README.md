# Linked

A responsive browser prototype based on the Linked concept document (30 September 2026). No installation or build step is needed.

Open `index.html`, or serve this directory on localhost for reliable geolocation and cross-tab storage. Google Fonts is optional; system fonts provide a fallback.

## Try it

1. Press **I need help**, or use **Try the bracelet demo**.
2. Allow location access, or save a meeting point if location is unavailable.
3. Open **Help point** to see the incoming alert.
4. Open **Volunteer**, switch on availability, and accept the alert.
5. Return to **Your night** to see the accepted state.
6. Close the response from **Help point**, or cancel it from **Your night**. Location and meeting point are cleared.

The browser requests a single location only after an alert is triggered. It does not track continuously. Late geolocation results are discarded after cancellation or closure. Unassigned volunteers do not see exact location in their view. The optional map link shares coordinates with OpenStreetMap when opened.

## Prototype boundaries

No real alert delivery, emergency response, authentication, partner integration, or bracelet hardware connection is implemented. The help point and Alex are demonstration roles, not confirmed partners. Data is saved in localStorage in this browser; this is not a secure multi-user service. Role tabs are demonstration interfaces, not access control. **Reset demo** clears local demo data. Geolocation requires browser permission and typically HTTPS or localhost. Browser storage may behave differently for directly opened files.

Real deployment needs an authenticated service, alert delivery and acknowledgments, verified responder access, an agreed retention policy, and an implemented bracelet transport. The document leaves these decisions open.

## Verification

Run `node app.test.cjs` for the alert lifecycle, location consent, cancellation, late callbacks, volunteer availability, escaped meeting points, persistence, and cross-tab synchronization checks. These use a simulated browser environment; they do not replace visual browser testing.

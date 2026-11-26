// Geopend door een NFC-polsbandje (…/?t=<token>): laat zien of het bandje
// herkend wordt. De hulpknop werkt altijd, ook als het bandje inactief of
// onbekend is of de server niet bereikbaar is. Het token is geen
// inloggegeven en wordt nergens anders voor gebruikt.
((global) => {
  const notice = document.querySelector("#wristband-notice");
  const title = document.querySelector("#wristband-notice-title");
  const text = document.querySelector("#wristband-notice-text");

  const messages = {
    checking: ["Checking your wristband…", "You can already ask for help below."],
    active: ["Wristband recognised", "You opened Linked with your wristband."],
    inactive: [
      "This wristband is no longer active",
      "You can still ask for help below.",
    ],
    unknown: ["Wristband not recognised", "You can still ask for help below."],
    offline: [
      "Your wristband could not be checked",
      "You can still ask for help below.",
    ],
  };

  function show(state, eventName) {
    const [heading, body] = messages[state];
    title.textContent = heading;
    text.textContent =
      state === "active" && eventName
        ? `You opened Linked with your wristband for ${eventName}.`
        : body;
    notice.dataset.state = state;
    notice.hidden = false;
  }

  function takeToken() {
    const params = new URLSearchParams(global.location.search);
    const token = params.get("t");
    if (token === null) return null;

    // Het token niet in de adresbalk of geschiedenis laten staan.
    params.delete("t");
    const query = params.toString();
    global.history.replaceState(
      null,
      "",
      `${global.location.pathname}${query ? `?${query}` : ""}${global.location.hash}`,
    );
    return token;
  }

  async function checkWristband() {
    const token = takeToken();
    if (token === null) return;

    show("checking");
    const result = await global.LinkedWristbandApi.createApi().resolve(token);
    if (!result.ok) {
      show("offline");
      return;
    }
    const known = ["active", "inactive", "unknown"].includes(result.status);
    show(known ? result.status : "unknown", result.eventName);
  }

  global.LinkedWristbandTap = Object.freeze({ ready: checkWristband() });
})(globalThis);

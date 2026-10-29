const bridgeStatus = document.querySelector("#bridge-status");
const connectButton = document.querySelector("#connect-arduino");
const scanButton = document.querySelector("#scan-tag");
const baseUrlForm = document.querySelector("#base-url-form");
const baseUrlInput = document.querySelector("#base-url");
const baseUrlHint = document.querySelector("#base-url-hint");
const saveBaseUrlButton = document.querySelector("#save-base-url");
const registerButton = document.querySelector("#register-wristband");
const currentWristbandCard = document.querySelector("#current-wristband");
const currentUrl = document.querySelector("#current-url");
const programButton = document.querySelector("#program-wristband");
const wristbandList = document.querySelector("#wristband-list");
const wristbandEmpty = document.querySelector("#wristband-empty");
const wristbandStore = globalThis.LinkedWristbandStore;

// De brug draait alleen lokaal; zie nfc/bridge/bridge.py.
const bridgeUrl = "http://127.0.0.1:5001";

const errorMessages = {
  BRIDGE_OFFLINE:
    "Could not reach the NFC bridge. Is bridge.py running on this computer?",
  ARDUINO_NOT_CONNECTED:
    "The bridge is running, but the Arduino is not connected.",
  TIMEOUT: "The Arduino did not answer in time.",
  TAG_NOT_FOUND: "No tag found. Place the wristband on the reader and try again.",
  UNSUPPORTED_TAG: "This tag is not supported. Use an NTAG213 wristband.",
  TAG_NOT_BLANK_NTAG213: "This tag is not a blank NTAG213.",
  TAG_NOT_BLANK:
    "This tag already contains data. Use a blank wristband so nothing is overwritten.",
  HTTPS_REQUIRED: "The wristband link must start with https://.",
  URL_TOO_LONG: "The wristband link is too long for the tag.",
  INVALID_URL: "The wristband link contains invalid characters.",
  READ_FAILED: "Could not read the tag. Hold it still and try again.",
  WRITE_FAILED: "Writing failed. Hold the tag still and try again.",
  VERIFY_READ_FAILED: "Written, but the tag could not be read back.",
  VERIFY_MISMATCH: "The tag content did not match after writing.",
  NO_SUPPORTED_NDEF_URL: "The tag does not contain a supported Linked link.",
  PN532_NOT_FOUND: "The Arduino cannot find the PN532 reader.",
};

let isBusy = false;

// Het nieuwste wachtende polsbandje is het bandje dat geprogrammeerd wordt,
// ook na vernieuwen van de pagina.
function getCurrentWristband(wristbands = wristbandStore.getWristbands()) {
  return wristbands.findLast((wristband) => wristband.status === "pending");
}

function describeError(result) {
  return (
    errorMessages[result.error] ??
    `The NFC writer reported an error: ${result.error}.`
  );
}

function setStatus(text) {
  bridgeStatus.textContent = text;
}

async function callBridge(endpoint, method = "POST", body) {
  try {
    const response = await fetch(`${bridgeUrl}/api/nfc/${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await response.json();
  } catch (error) {
    console.error("Could not reach the NFC bridge.", error);
    return { ok: false, error: "BRIDGE_OFFLINE" };
  }
}

// Eén opdracht tegelijk: de Arduino verwerkt opdrachten na elkaar.
async function runBusy(task) {
  if (isBusy) {
    return;
  }

  isBusy = true;
  render();
  try {
    await task();
  } finally {
    isBusy = false;
    render();
  }
}

function formatStatus(status) {
  return status[0].toUpperCase() + status.slice(1);
}

function renderList(wristbands) {
  wristbandList.replaceChildren(
    ...wristbands
      .slice()
      .reverse()
      .map((wristband) => {
        const item = document.createElement("li");
        item.className = "wristband-item";

        const text = document.createElement("div");
        const token = document.createElement("p");
        token.className = "wristband-token";
        token.textContent =
          `${wristband.token} · ${formatStatus(wristband.status)}`;
        const details = document.createElement("p");
        details.textContent = wristband.uid
          ? `${wristband.url} · UID ${wristband.uid}`
          : wristband.url;
        text.append(token, details);
        item.append(text);

        if (wristband.status !== "inactive") {
          const button = document.createElement("button");
          button.className = "secondary";
          button.type = "button";
          button.textContent = "Deactivate";
          button.setAttribute("aria-label", `Deactivate ${wristband.token}`);
          button.disabled = isBusy;
          button.addEventListener("click", () => deactivate(wristband.id));
          item.append(button);
        }

        return item;
      }),
  );
  wristbandEmpty.hidden = wristbands.length > 0;
}

function render() {
  const wristbands = wristbandStore.getWristbands();
  const current = getCurrentWristband(wristbands);
  const hasBaseUrl = wristbandStore.getBaseUrl() !== null;

  connectButton.disabled = isBusy;
  scanButton.disabled = isBusy;
  saveBaseUrlButton.disabled = isBusy;
  registerButton.disabled = isBusy || !hasBaseUrl || Boolean(current);
  programButton.disabled = isBusy || !current;
  currentWristbandCard.hidden = !current;
  currentUrl.textContent = current ? current.url : "";

  renderList(wristbands);
}

function saveBaseUrl(event) {
  event.preventDefault();
  const baseUrl = wristbandStore.setBaseUrl(baseUrlInput.value);
  if (!baseUrl) {
    baseUrlHint.textContent =
      "Enter a short https:// address. The wristband link may be at most " +
      `${wristbandStore.maxUrlSuffix} characters after https://.`;
    baseUrlInput.setAttribute("aria-invalid", "true");
    render();
    return;
  }

  baseUrlInput.value = baseUrl;
  baseUrlInput.removeAttribute("aria-invalid");
  baseUrlHint.textContent =
    `Saved. New wristbands link to ${wristbandStore.buildUrl("…")}`;
  render();
}

function connectArduino() {
  return runBusy(async () => {
    setStatus("Connecting to the Arduino…");
    const result = await callBridge("status", "GET");
    setStatus(result.ok ? "Arduino connected." : describeError(result));
  });
}

function scanTag() {
  return runBusy(async () => {
    setStatus("Place a tag on the reader…");
    const result = await callBridge("scan");
    setStatus(
      result.ok ? `Tag detected. UID: ${result.uid}` : describeError(result),
    );
  });
}

function registerWristband() {
  const wristband = wristbandStore.createWristband();
  if (!wristband) {
    setStatus("Save a valid Linked address before registering a wristband.");
    render();
    return;
  }

  setStatus(`Wristband ${wristband.token} registered. Ready to program.`);
  render();
  programButton.focus();
}

function programWristband() {
  return runBusy(async () => {
    const wristband = getCurrentWristband();
    if (!wristband) {
      return;
    }

    setStatus("Place the wristband on the reader. Writing…");
    const written = await callBridge("write", "POST", { url: wristband.url });
    if (!written.ok) {
      setStatus(describeError(written));
      return;
    }

    // Opnieuw uitlezen: activeren gebeurt alleen na een geslaagde controle.
    setStatus("Written. Verifying the wristband…");
    const verified = await callBridge("read");
    if (!verified.ok) {
      setStatus(describeError(verified));
      return;
    }

    const activated = wristbandStore.activateWristband(
      wristband.id,
      verified.uid,
      verified.url,
    );
    if (!activated) {
      setStatus(
        "The tag returned a different link. The wristband stays pending.",
      );
      return;
    }

    setStatus(`Wristband ${activated.token} programmed, verified and active.`);
  });
}

function deactivate(id) {
  const wristband = wristbandStore.deactivateWristband(id);
  if (wristband) {
    setStatus(`Wristband ${wristband.token} deactivated.`);
  }
  render();
}

globalThis.addEventListener("storage", (event) => {
  if (
    event.key === wristbandStore.storageKey ||
    event.key === wristbandStore.baseUrlKey
  ) {
    render();
  }
});

baseUrlInput.value = wristbandStore.getBaseUrl() ?? "";
baseUrlForm.addEventListener("submit", saveBaseUrl);
connectButton.addEventListener("click", connectArduino);
scanButton.addEventListener("click", scanTag);
registerButton.addEventListener("click", registerWristband);
programButton.addEventListener("click", programWristband);
render();

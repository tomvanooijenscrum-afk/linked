// Beheerpagina NFC-polsbanden: lezer verbinden, registreren, beheren.
// De server controleert bij elke aanvraag of de gebruiker beheerder is;
// het verbergen van knoppen hier is alleen gemak, geen beveiliging.

const $ = (id) => document.querySelector(`#${id}`);

const el = {
  pageMessage: $("page-message"),
  signedInAs: $("signed-in-as"),
  signOut: $("sign-out"),
  signinCard: $("signin-card"),
  signinForm: $("signin-form"),
  signinUsername: $("signin-username"),
  signinPassword: $("signin-password"),
  signinError: $("signin-error"),
  signinSubmit: $("signin-submit"),
  adminArea: $("admin-area"),
  readerState: $("reader-state"),
  readerMessage: $("reader-message"),
  unsupportedNote: $("unsupported-note"),
  connectReader: $("connect-reader"),
  disconnectReader: $("disconnect-reader"),
  scanTag: $("scan-tag"),
  scanResult: $("scan-result"),
  scanUid: $("scan-uid"),
  scanType: $("scan-type"),
  scanContent: $("scan-content"),
  scanRegistration: $("scan-registration"),
  eventSelect: $("event-select"),
  eventForm: $("event-form"),
  eventName: $("event-name"),
  registerButton: $("register-button"),
  registration: $("registration"),
  stepList: $("step-list"),
  registrationMessage: $("registration-message"),
  registrationUrl: $("registration-url"),
  activateButton: $("activate-button"),
  overwriteButton: $("overwrite-button"),
  retryButton: $("retry-button"),
  closeRegistration: $("close-registration"),
  wristbandCount: $("wristband-count"),
  searchForm: $("search-form"),
  searchInput: $("search-input"),
  statusFilter: $("status-filter"),
  listMessage: $("list-message"),
  wristbandList: $("wristband-list"),
  wristbandEmpty: $("wristband-empty"),
};

const serial = globalThis.LinkedNfcSerial;
const api = globalThis.LinkedWristbandApi.createApi();
const steps = ["scan", "check", "reserve", "write", "verify", "confirm"];

const messages = {
  // Browser en USB
  UNSUPPORTED_BROWSER:
    "This browser cannot use USB devices. Use Chrome or Edge on a computer.",
  NO_PORT_SELECTED: "No reader was selected.",
  PERMISSION_DENIED: "The browser was not allowed to use the USB device.",
  PORT_BUSY:
    "The USB port is in use. Close the Arduino Serial Monitor and stop bridge.py, then try again.",
  PORT_ALREADY_OPEN: "The reader is already open in another tab or window.",
  ALREADY_CONNECTED: "The reader is already connected.",
  NOT_CONNECTED: "Connect the reader first.",
  READER_DISCONNECTED: "The reader was disconnected. Check the USB cable and connect again.",
  READER_NOT_RESPONDING: "The reader stopped responding. Connect it again.",
  READER_RESET: "The Arduino restarted during the operation. Try again.",
  DISCONNECTED: "The reader was disconnected.",
  TIMEOUT: "The reader did not answer in time.",
  INCOMPLETE_RESPONSE: "The reader sent an incomplete answer. Try again.",
  FIRMWARE_OUTDATED:
    "The Arduino runs old firmware. Upload nfc/firmware/linked_nfc (version 2).",
  PN532_NOT_FOUND: "The Arduino cannot find the PN532. Check the wiring and the SPI switches.",
  // Firmware
  TAG_NOT_FOUND: "No tag found. Place the wristband on the reader and try again.",
  UNSUPPORTED_TAG: "This tag is not supported. Use an NTAG213 wristband.",
  TAG_READ_ONLY: "This tag is locked and cannot be written.",
  TAG_NOT_BLANK:
    "This tag already contains data. Overwrite it only if you are sure it is not in use.",
  UID_MISMATCH: "A different tag was placed on the reader. Use the same wristband.",
  READ_FAILED: "Could not read the tag. Hold it still and try again.",
  WRITE_FAILED: "Writing failed. Hold the tag still and try again.",
  VERIFY_READ_FAILED: "Written, but the tag could not be read back. Try again.",
  VERIFY_MISMATCH: "The tag content did not match after writing. Try again.",
  NO_SUPPORTED_NDEF_URL: "The tag does not contain a readable link.",
  HTTPS_REQUIRED: "The wristband link must start with https://.",
  URL_TOO_LONG: "The wristband link is too long for an NTAG213.",
  INVALID_URL: "The wristband link contains invalid characters.",
  COMMAND_TOO_LONG: "The command was too long for the reader.",
  INCOMPLETE_COMMAND: "The reader received an incomplete command. Try again.",
  // Server
  SERVER_OFFLINE: "Could not reach the Linked server. Is it running?",
  INVALID_RESPONSE: "The server sent an unexpected answer.",
  NOT_SIGNED_IN: "Your session has ended. Sign in again.",
  FORBIDDEN: "Only administrators can manage wristbands.",
  INVALID_CREDENTIALS: "Wrong username or password.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait 15 minutes and try again.",
  DUPLICATE_TAG: "This tag is already registered.",
  PUBLIC_URL_NOT_CONFIGURED:
    "The server has no public Linked address. Set LINKED_PUBLIC_BASE_URL.",
  URL_MISMATCH: "The link on the tag does not belong to this registration. Try again.",
  NOT_VERIFIED: "Only a verified wristband can be activated.",
  ALREADY_VERIFIED: "This wristband is already verified.",
  NOT_FOUND: "This wristband no longer exists.",
  INVALID_UID: "The tag UID is not a 7-byte NTAG213 UID.",
  DUPLICATE_EVENT: "An event with this name already exists.",
  INVALID_EVENT_NAME: "Enter an event name of at most 80 characters.",
  INVALID_EVENT: "That event does not exist any more.",
};

const readerStates = {
  disconnected: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
};

const progressSteps = {
  WAITING_FOR_TAG: "Waiting for a tag…",
  WRITING: "Writing…",
  VERIFYING: "Verifying…",
};

let user = null;
let readerBusy = false;
let readerState = "disconnected";
let registration = null;
let wristbands = [];
let searchTimer = null;
let listRequest = 0;

const reader = serial.createReader({
  onEvent(event) {
    if (event.type === "state") {
      readerState = event.state;
      if (event.state === "disconnected" && event.reason) {
        setText(el.readerMessage, describe(event.reason));
      }
      render();
    } else if (event.type === "progress" && progressSteps[event.step]) {
      setText(el.readerMessage, progressSteps[event.step]);
    }
  },
});

function describe(code) {
  return messages[code] ?? `Error: ${code}.`;
}

function setText(element, text) {
  element.textContent = text;
}

function show(element, visible) {
  element.hidden = !visible;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusOf(wristband) {
  if (wristband.writeStatus === "failed") return "failed";
  if (wristband.writeStatus === "reserved") return "pending";
  return wristband.isActive ? "active" : "inactive";
}

function statusLabel(status) {
  return status[0].toUpperCase() + status.slice(1);
}

// Een verlopen sessie of ingetrokken rol brengt je terug naar inloggen.
function handleAuthError(result) {
  if (result.httpStatus !== 401 && result.httpStatus !== 403) return false;
  user = null;
  registration = null;
  showPageMessage(describe(result.error));
  render();
  return true;
}

function showPageMessage(text) {
  setText(el.pageMessage, text);
  show(el.pageMessage, Boolean(text));
}

// ---- Weergave -------------------------------------------------------------

function render() {
  const isAdmin = user?.role === "admin";
  const supported = serial.isSupported();
  const connected = readerState === "connected";

  show(el.signinCard, !isAdmin);
  show(el.adminArea, isAdmin);
  show(el.signOut, Boolean(user));
  show(el.signedInAs, Boolean(user));
  setText(el.signedInAs, user ? `${user.username} · ${user.role}` : "");

  el.readerState.dataset.state = readerState;
  setText(el.readerState, readerStates[readerState]);
  show(el.unsupportedNote, !supported);
  el.connectReader.disabled = !supported || readerState !== "disconnected";
  show(el.connectReader, !connected);
  show(el.disconnectReader, connected);
  el.disconnectReader.disabled = readerBusy;
  el.scanTag.disabled = !connected || readerBusy;
  el.registerButton.disabled = !connected || readerBusy;

  renderRegistration();
  renderList();
}

function renderRegistration() {
  show(el.registration, Boolean(registration));
  if (!registration) return;

  for (const item of el.stepList.children) {
    const index = steps.indexOf(item.dataset.step);
    const current = steps.indexOf(registration.step);
    let state = "todo";
    if (index < current || registration.done) state = "done";
    else if (index === current) state = registration.error ? "failed" : "active";
    item.dataset.state = state;
    if (state === "active") item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  }

  const band = registration.wristband;
  const canActivate = registration.done && band && !band.isActive;
  show(el.activateButton, canActivate);
  el.activateButton.disabled = readerBusy;
  show(el.overwriteButton, registration.error === "TAG_NOT_BLANK");
  el.overwriteButton.disabled = readerBusy || readerState !== "connected";
  const canRetry = Boolean(registration.error) && registration.error !== "DUPLICATE_TAG";
  show(el.retryButton, canRetry);
  el.retryButton.disabled = readerBusy || readerState !== "connected";
  show(el.closeRegistration, !readerBusy);
  show(el.registrationUrl, Boolean(registration.url) && registration.done);
  setText(el.registrationUrl, registration.done ? registration.url : "");
}

function actionButton(label, accessibleLabel, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = label;
  button.setAttribute("aria-label", accessibleLabel);
  button.addEventListener("click", onClick);
  return button;
}

function renderList() {
  el.wristbandList.replaceChildren(
    ...wristbands.map((band) => {
      const status = statusOf(band);
      const item = document.createElement("li");
      item.className = "wristband-item";
      item.dataset.status = status;

      const text = document.createElement("div");
      const title = document.createElement("p");
      title.className = "wristband-token";
      title.textContent = `${band.label} · ${statusLabel(status)}`;
      const details = document.createElement("p");
      details.textContent = [
        `UID ${band.tagUid}`,
        band.eventName,
        `Registered ${formatDate(band.registeredAt)} by ${band.registeredBy}`,
      ]
        .filter(Boolean)
        .join(" · ");
      text.append(title, details);
      if (status === "failed" && band.lastError) {
        const error = document.createElement("p");
        error.className = "field-error";
        error.textContent = `Last attempt: ${band.lastError}`;
        text.append(error);
      }
      item.append(text);

      const name = band.label;
      if (status === "active") {
        item.append(actionButton("Deactivate", `Deactivate ${name}`, () => setActive(band, false)));
      } else if (status === "inactive") {
        item.append(actionButton("Activate", `Activate ${name}`, () => setActive(band, true)));
      } else {
        item.append(actionButton("Discard", `Discard unfinished ${name}`, () => discard(band)));
      }
      return item;
    }),
  );
  show(el.wristbandEmpty, wristbands.length === 0);
  setText(el.wristbandCount, String(wristbands.length));
}

// ---- Server ---------------------------------------------------------------

async function loadWristbands() {
  const request = ++listRequest;
  const result = await api.listWristbands({
    q: el.searchInput.value,
    status: el.statusFilter.value,
  });
  // Een trager, ouder zoekresultaat overschrijft geen nieuwer resultaat.
  if (request !== listRequest) return;
  if (!result.ok) {
    if (!handleAuthError(result)) setText(el.listMessage, describe(result.error));
    return;
  }
  wristbands = result.wristbands;
  setText(el.listMessage, "");
  render();
}

async function loadEvents(selectId) {
  const result = await api.listEvents();
  if (!result.ok) return;
  const selected = selectId ?? el.eventSelect.value;
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No event";
  el.eventSelect.replaceChildren(
    none,
    ...result.events.map((event) => {
      const option = document.createElement("option");
      option.value = String(event.id);
      option.textContent = event.name;
      return option;
    }),
  );
  el.eventSelect.value = String(selected ?? "");
}

async function startAdmin() {
  showPageMessage("");
  render();
  await Promise.all([loadEvents(), loadWristbands()]);
}

async function checkSession() {
  const result = await api.me();
  if (result.ok) {
    user = result.user;
    if (user.role !== "admin") showPageMessage(describe("FORBIDDEN"));
  } else if (result.httpStatus !== 401) {
    showPageMessage(describe(result.error));
  }
  if (user?.role === "admin") await startAdmin();
  else render();
}

async function signIn(event) {
  event.preventDefault();
  el.signinSubmit.disabled = true;
  const result = await api.login(el.signinUsername.value, el.signinPassword.value);
  el.signinSubmit.disabled = false;
  el.signinPassword.value = "";
  if (!result.ok) {
    setText(el.signinError, describe(result.error));
    show(el.signinError, true);
    return;
  }
  show(el.signinError, false);
  user = result.user;
  if (user.role !== "admin") {
    showPageMessage(describe("FORBIDDEN"));
    render();
    return;
  }
  await startAdmin();
}

async function signOut() {
  await reader.disconnect();
  await api.logout();
  user = null;
  registration = null;
  wristbands = [];
  render();
}

async function addEvent(event) {
  event.preventDefault();
  const result = await api.createEvent(el.eventName.value);
  if (!result.ok) {
    if (!handleAuthError(result)) showPageMessage(describe(result.error));
    return;
  }
  el.eventName.value = "";
  showPageMessage("");
  await loadEvents(result.event.id);
}

async function setActive(band, active) {
  const result = active ? await api.activate(band.id) : await api.deactivate(band.id);
  if (!result.ok) {
    if (!handleAuthError(result)) setText(el.listMessage, describe(result.error));
    return;
  }
  if (registration?.wristband?.id === band.id) registration.wristband = result.wristband;
  await loadWristbands();
  setText(el.listMessage, `${band.label} ${active ? "activated" : "deactivated"}.`);
}

async function discard(band) {
  const result = await api.discard(band.id);
  if (!result.ok) {
    if (!handleAuthError(result)) setText(el.listMessage, describe(result.error));
    return;
  }
  await loadWristbands();
  setText(el.listMessage, `Unfinished ${band.label} discarded.`);
}

// ---- Lezer ----------------------------------------------------------------

// Eén lezer-opdracht tegelijk.
async function withReader(task) {
  if (readerBusy) return;
  readerBusy = true;
  render();
  try {
    await task();
  } finally {
    readerBusy = false;
    render();
  }
}

function connectReader() {
  return withReader(async () => {
    setText(el.readerMessage, "Choose the Arduino in the browser window…");
    const result = await reader.connect();
    setText(
      el.readerMessage,
      result.ok ? "Reader connected. Place a tag on the reader." : describe(result.error),
    );
  });
}

async function disconnectReader() {
  await reader.disconnect();
  setText(el.readerMessage, "Reader disconnected.");
  render();
}

function describeContent(info) {
  if (info.type === "UNSUPPORTED") return "Not readable (not an NTAG tag)";
  switch (info.ndef) {
    case "BLANK":
      return "Blank";
    case "URL":
      return info.url;
    case "OTHER":
      return "Other NFC data (not a link)";
    case "INVALID":
      return "Damaged or incomplete data";
    default:
      return "No NFC data area";
  }
}

function scanAndIdentify() {
  return withReader(async () => {
    show(el.scanResult, false);
    setText(el.readerMessage, "Place a tag on the reader…");
    const info = await reader.info();
    if (!info.ok) {
      setText(el.readerMessage, describe(info.error));
      return;
    }

    setText(el.scanUid, info.uid);
    setText(el.scanType, `${info.type ?? "Unknown"}${info.locked ? " · locked" : ""}`);
    setText(el.scanContent, describeContent(info));
    setText(el.scanRegistration, "Checking…");
    show(el.scanResult, true);
    setText(el.readerMessage, "Tag read.");

    const found = info.uid.length === 14 ? await api.lookup(info.uid) : { ok: true };
    if (!found.ok) {
      setText(el.scanRegistration, describe(found.error));
      handleAuthError(found);
      return;
    }
    const band = found.wristband;
    setText(
      el.scanRegistration,
      band
        ? `${band.label} · ${statusLabel(statusOf(band))}${band.eventName ? ` · ${band.eventName}` : ""}`
        : "Not registered",
    );
  });
}

// ---- Registratie (stap 3-11 van de workflow) ------------------------------
// Elke poging werkt op haar eigen object `reg`. Wordt de registratie
// gesloten of verloopt de sessie, dan stopt de poging na de lopende stap.

const isCurrent = (reg) => registration === reg;

function setStep(reg, step, text) {
  if (!isCurrent(reg)) return false;
  reg.step = step;
  reg.error = null;
  setText(el.registrationMessage, text);
  render();
  return true;
}

async function failStep(reg, code, { report } = {}) {
  // Mislukte poging ook op de server vastleggen (fouten hierbij negeren).
  if (report && reg.wristband) {
    await api.reportFailure(reg.wristband.id, report, code);
  }
  if (!isCurrent(reg)) return;
  reg.error = code;
  let text = describe(code);
  if (code === "DUPLICATE_TAG" && reg.duplicate) {
    const band = reg.duplicate;
    text = `This tag is already registered as ${band.label} (${statusLabel(statusOf(band))}).`;
  }
  setText(el.registrationMessage, text);
  render();
  if (report) await loadWristbands();
}

async function runRegistration(reg, { replace = false, from = "scan" } = {}) {
  if (from === "confirm") return confirmRegistration(reg);

  if (from === "scan") {
    if (!setStep(reg, "scan", "Place the wristband on the reader…")) return;
    const scanned = await reader.scan();
    if (!scanned.ok) return failStep(reg, scanned.error);
    if (!/^[0-9A-F]{14}$/.test(scanned.uid ?? "")) return failStep(reg, "UNSUPPORTED_TAG");
    reg.uid = scanned.uid;

    if (!setStep(reg, "check", `Tag ${scanned.uid} found. Checking registrations…`)) return;
    const found = await api.lookup(scanned.uid);
    if (!found.ok) {
      if (handleAuthError(found)) return;
      return failStep(reg, found.error);
    }
    if (found.wristband?.writeStatus === "verified") {
      reg.duplicate = found.wristband;
      return failStep(reg, "DUPLICATE_TAG");
    }

    if (!setStep(reg, "reserve", "Reserving a registration link…")) return;
    const eventId = el.eventSelect.value === "" ? null : Number(el.eventSelect.value);
    const reserved = await api.reserve(scanned.uid, eventId);
    if (!reserved.ok) {
      if (handleAuthError(reserved)) return;
      reg.duplicate = reserved.wristband;
      return failStep(reg, reserved.error);
    }
    reg.wristband = reserved.wristband;
    reg.url = reserved.url;
    // Een eerdere, mislukte poging op deze tag mag worden overschreven.
    reg.replace = reserved.retry;
  }

  if (!setStep(reg, "write", "Writing the link. Keep the wristband on the reader…")) return;
  const written = await reader.write(reg.uid, reg.url, {
    replace: replace || reg.replace,
  });
  if (!written.ok) return failStep(reg, written.error, { report: "write" });

  if (!setStep(reg, "verify", "Reading the link back…")) return;
  const verified = await reader.read();
  if (!verified.ok) return failStep(reg, verified.error, { report: "verify" });
  if (verified.uid !== reg.uid) return failStep(reg, "UID_MISMATCH", { report: "verify" });
  if (verified.url !== reg.url) return failStep(reg, "VERIFY_MISMATCH", { report: "verify" });

  return confirmRegistration(reg);
}

async function confirmRegistration(reg) {
  if (!setStep(reg, "confirm", "Confirming with the server…")) return;
  const confirmed = await api.confirm(reg.wristband.id, reg.uid, reg.url);
  if (!confirmed.ok) {
    if (handleAuthError(confirmed)) return;
    // De tag is goed; alleen de bevestiging hoeft opnieuw (idempotent).
    reg.retryFrom = "confirm";
    return failStep(reg, confirmed.error);
  }
  if (!isCurrent(reg)) return;
  reg.wristband = confirmed.wristband;
  reg.done = true;
  reg.retryFrom = null;
  setText(
    el.registrationMessage,
    `${confirmed.wristband.label} is written and verified. Activate it to let it open Linked.`,
  );
  render();
  el.activateButton.focus();
  await loadWristbands();
}

function newRegistration() {
  registration = { step: "scan", error: null, done: false };
  return registration;
}

function registerWristband() {
  return withReader(() => runRegistration(newRegistration()));
}

function retryRegistration() {
  return withReader(() => {
    if (registration.retryFrom === "confirm") {
      registration.error = null;
      return runRegistration(registration, { from: "confirm" });
    }
    return runRegistration(newRegistration());
  });
}

function overwriteTag() {
  return withReader(() => runRegistration(registration, { replace: true, from: "write" }));
}

async function activateRegistered() {
  const band = registration.wristband;
  const result = await api.activate(band.id);
  if (!result.ok) {
    if (!handleAuthError(result)) setText(el.registrationMessage, describe(result.error));
    return;
  }
  registration.wristband = result.wristband;
  setText(el.registrationMessage, `${band.label} is active. A phone tap now opens Linked.`);
  render();
  await loadWristbands();
}

function closeRegistration() {
  registration = null;
  render();
  el.registerButton.focus();
}

// ---- Gebeurtenissen -------------------------------------------------------

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadWristbands, 250);
}

el.signinForm.addEventListener("submit", signIn);
el.signOut.addEventListener("click", signOut);
el.connectReader.addEventListener("click", connectReader);
el.disconnectReader.addEventListener("click", disconnectReader);
el.scanTag.addEventListener("click", scanAndIdentify);
el.eventForm.addEventListener("submit", addEvent);
el.registerButton.addEventListener("click", registerWristband);
el.retryButton.addEventListener("click", retryRegistration);
el.overwriteButton.addEventListener("click", overwriteTag);
el.activateButton.addEventListener("click", activateRegistered);
el.closeRegistration.addEventListener("click", closeRegistration);
el.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadWristbands();
});
el.searchInput.addEventListener("input", scheduleSearch);
el.statusFilter.addEventListener("change", loadWristbands);

render();
checkSession();

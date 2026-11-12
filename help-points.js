const helpPointList = document.querySelector("#help-point-list");
const openNowFilter = document.querySelector("#open-now");
const resultsStatus = document.querySelector("#results-status");
const noPointsState = document.querySelector("#no-points");
const noOpenPointsState = document.querySelector("#no-open-points");
const detailsPanel = document.querySelector("#help-point-details");
const helpPointData = globalThis.LinkedHelpPointData;
const helpPoints = helpPointData.helpPoints;
const validationErrors =
  globalThis.LinkedHelpPoints.validateHelpPointData(helpPoints);

if (validationErrors.length > 0) {
  throw new Error(`Invalid help-point data: ${validationErrors.join(" ")}`);
}

document.querySelector("#event-name").textContent =
  `${helpPointData.eventName} — ${helpPointData.eventLabel}`;

let selectedPointId = null;
let renderedDetailsPointId;

function formatDayNames(days) {
  const sortedDays = [...days].sort((a, b) => a - b);
  if (
    sortedDays.length === 5 &&
    sortedDays[0] === 1 &&
    sortedDays[4] === 5
  ) {
    return "Mon–Fri";
  }
  if (
    sortedDays.length === 7 &&
    sortedDays[0] === 0 &&
    sortedDays[6] === 6
  ) {
    return "Daily";
  }
  return sortedDays.map((day) => globalThis.LinkedHelpPoints.dayNames[day]).join(", ");
}

function formatHours(point) {
  return point.openingHours.map((rule) =>
    `${formatDayNames(rule.days)}: ${rule.opens}–${rule.closes}${rule.closes <= rule.opens ? " next day" : ""}`,
  );
}

function appendDetail(parent, label, content) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.append(content);
  wrapper.append(term, description);
  parent.append(wrapper);
}

function renderDetails(point) {
  const heading = document.createElement("h3");
  heading.className = "detail-heading";
  heading.textContent = point.name;
  const details = document.createElement("dl");
  details.className = "details-grid";

  appendDetail(details, "Location", document.createTextNode(point.location));

  const hoursList = document.createElement("ul");
  for (const hours of formatHours(point)) {
    const item = document.createElement("li");
    item.textContent = hours;
    hoursList.append(item);
  }
  appendDetail(details, "Opening hours (unverified)", hoursList);
  appendDetail(details, "Detailed directions", document.createTextNode(point.directions));

  const landmarks = document.createElement("ul");
  landmarks.className = "landmarks";
  for (const landmark of point.landmarks) {
    const item = document.createElement("li");
    item.textContent = landmark;
    landmarks.append(item);
  }
  appendDetail(details, "Landmarks", landmarks);

  if (point.closedDates.length || point.closedPeriods.length) {
    const closureList = document.createElement("ul");
    for (const date of point.closedDates) {
      const item = document.createElement("li");
      item.textContent = `Closed all day ${date}`;
      closureList.append(item);
    }
    for (const period of point.closedPeriods) {
      const item = document.createElement("li");
      item.textContent = `Closed ${period.start.replace("T", " ")} to ${period.end.replace("T", " ")}`;
      closureList.append(item);
    }
    appendDetail(details, "Scheduled closures", closureList);
  }

  const detailsTitle = document.createElement("h2");
  detailsTitle.id = "details-title";
  detailsTitle.textContent = "Help point details";
  detailsPanel.replaceChildren(detailsTitle, heading, details);
}

function render() {
  const focusedPointId =
    document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.pointId
      : null;
  const now = new Date();
  const visiblePoints = helpPoints.filter(
    (point) => !openNowFilter.checked || globalThis.LinkedHelpPoints.isOpenNow(point, now),
  );
  if (!visiblePoints.some((point) => point.id === selectedPointId)) {
    selectedPointId = null;
  }

  helpPointList.replaceChildren();
  noPointsState.hidden = helpPoints.length !== 0;
  noOpenPointsState.hidden =
    helpPoints.length === 0 || visiblePoints.length !== 0 || !openNowFilter.checked;
  const nextResultsStatus =
    helpPoints.length === 0
      ? "No help points are available."
      : visiblePoints.length === 0
        ? "No help points are open now."
        : `${visiblePoints.length} ${visiblePoints.length === 1 ? "help point" : "help points"} listed${openNowFilter.checked ? " and open now" : ""}.`;
  if (resultsStatus.textContent !== nextResultsStatus) {
    resultsStatus.textContent = nextResultsStatus;
  }

  for (const point of visiblePoints) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const copy = document.createElement("span");
    const name = document.createElement("span");
    const location = document.createElement("span");
    const openState = document.createElement("span");
    const isOpen = globalThis.LinkedHelpPoints.isOpenNow(point, now);

    button.type = "button";
    button.className = "point-button";
    button.setAttribute("aria-pressed", String(point.id === selectedPointId));
    copy.className = "point-copy";
    name.className = "point-name";
    name.textContent = point.name;
    location.className = "point-location";
    location.textContent = point.location;
    openState.className = "open-state";
    openState.dataset.open = String(isOpen);
    openState.textContent = isOpen ? "Open now" : "Closed now";
    copy.append(name, location);
    button.append(copy, openState);
    button.addEventListener("click", () => {
      selectedPointId = point.id;
      render();
      const selectedButton = helpPointList.querySelector(
        `[data-point-id="${point.id}"]`,
      );
      if (selectedButton) {
        selectedButton.focus();
      }
    });
    button.dataset.pointId = point.id;
    item.append(button);
    helpPointList.append(item);
  }

  const selectedPoint = helpPoints.find((point) => point.id === selectedPointId);
  if (selectedPointId !== renderedDetailsPointId) {
    if (selectedPoint) {
      renderDetails(selectedPoint);
    } else {
      const detailsTitle = document.createElement("h2");
      detailsTitle.id = "details-title";
      detailsTitle.textContent = "Help point details";
      const prompt = document.createElement("p");
      prompt.id = "details-prompt";
      prompt.textContent = "Select a help point to see its details.";
      detailsPanel.replaceChildren(detailsTitle, prompt);
    }
    renderedDetailsPointId = selectedPointId;
  }

  if (focusedPointId) {
    const focusedButton = helpPointList.querySelector(
      `[data-point-id="${focusedPointId}"]`,
    );
    if (focusedButton) {
      focusedButton.focus();
    } else {
      openNowFilter.focus();
    }
  }
}

openNowFilter.addEventListener("change", () => render());
render();
setInterval(() => render(), 60_000);

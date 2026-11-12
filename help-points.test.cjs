const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const dataSource = fs.readFileSync(
  path.join(__dirname, "help-points-data.js"),
  "utf8",
);
const source = fs.readFileSync(path.join(__dirname, "help-points.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "help-points.html"), "utf8");
const overview = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function controlledDate(timestamp) {
  const NativeDate = Date;
  return class ControlledDate extends NativeDate {
    constructor(...args) {
      super(...(args.length === 0 ? [timestamp] : args));
    }

    static now() {
      return new NativeDate(timestamp).getTime();
    }
  };
}

function createElement(tagName = "div") {
  return {
    tagName,
    textContent: "",
    value: "",
    hidden: false,
    checked: false,
    disabled: false,
    focused: false,
    type: "",
    className: "",
    dataset: {},
    attributes: {},
    listeners: {},
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    focus() {
      this.focused = true;
    },
    querySelector(selector) {
      const expectedId = selector.match(/^\[data-point-id="(.+)"\]$/)?.[1];
      if (!expectedId) {
        return null;
      }
      return findElement(this, (element) => element.dataset.pointId === expectedId);
    },
  };
}

function findElement(root, predicate) {
  for (const child of root.children) {
    if (predicate(child)) {
      return child;
    }
    const nested = findElement(child, predicate);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function getText(root) {
  return [root.textContent, ...root.children.map(getText)].filter(Boolean).join(" ");
}

function setup({ timestamp, points } = {}) {
  const now = timestamp || new Date(2026, 11, 25, 22, 30).getTime();
  const selectors = [
    "#event-name",
    "#help-point-list",
    "#open-now",
    "#results-status",
    "#no-points",
    "#no-open-points",
    "#help-point-details",
  ];
  const elements = new Map(
    selectors.map((selector) => [selector, createElement()]),
  );
  const context = vm.createContext({
    Date: controlledDate(now),
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Unknown selector: ${selector}`);
        return elements.get(selector);
      },
      createElement,
      createTextNode(text) {
        const node = createElement("#text");
        node.textContent = text;
        return node;
      },
    },
    setInterval() {},
  });
  vm.runInContext(dataSource, context);
  if (points) {
    context.LinkedHelpPointData.helpPoints = points;
  }
  vm.runInContext(source, context);

  return {
    context,
    elements,
    get: (selector) => elements.get(selector),
    clickPoint(index = 0) {
      const button = elements.get("#help-point-list").children[index].children[0];
      button.listeners.click();
      return button;
    },
    filterOpen(checked) {
      const filter = elements.get("#open-now");
      filter.checked = checked;
      filter.listeners.change();
    },
  };
}

function makePoint(overrides = {}) {
  return {
    id: "test-point",
    name: "Test help point",
    location: "Fictional test location",
    openingHours: [{ days: [2], opens: "09:00", closes: "17:00" }],
    directions: "Follow the fictional path to the blue tent.",
    landmarks: ["Blue demo tent"],
    closedDates: [],
    closedPeriods: [],
    ...overrides,
  };
}

const dataContext = vm.createContext({ Date });
vm.runInContext(dataSource, dataContext);
const helpPointApi = dataContext.LinkedHelpPoints;
assert.deepEqual(
  Array.from(helpPointApi.validateHelpPointData(dataContext.LinkedHelpPointData.helpPoints)),
  [],
  "Stratumseind fictional demo data passes validation",
);
assert.ok(
  helpPointApi.validateHelpPointData([
    makePoint({
      openingHours: [{ days: [7], opens: "09:00", closes: "09:00" }],
      closedDates: ["2026-02-30"],
      closedPeriods: [{ start: "2026-02-03T14:00", end: "2026-02-03T13:00" }],
    }),
  ]).length >= 3,
  "Invalid weekdays, ranges, and dates are reported",
);
assert.ok(
  helpPointApi.validateHelpPointData([
    makePoint(),
    makePoint({ id: "test-point" }),
  ]).some((error) => error.includes("unique")),
  "Duplicate help-point ids are reported",
);

const overnightPoint = makePoint({
  openingHours: [{ days: [1], opens: "22:00", closes: "02:00" }],
});
assert.equal(
  helpPointApi.isOpenNow(overnightPoint, new Date(2026, 1, 3, 1, 0)),
  true,
  "A Monday overnight range remains open early Tuesday",
);
assert.equal(
  helpPointApi.isOpenNow(overnightPoint, new Date(2026, 1, 3, 2, 0)),
  false,
  "The overnight closing boundary is exclusive",
);
assert.equal(
  helpPointApi.isOpenNow(
    makePoint({
      openingHours: [{ days: [2], opens: "00:00", closes: "02:00" }],
    }),
    new Date(2026, 1, 3, 1, 0),
  ),
  true,
  "Opening times at a day boundary use the new weekday",
);
assert.equal(
  helpPointApi.isOpenNow(
    makePoint({ closedDates: ["2026-02-03"] }),
    new Date(2026, 1, 3, 12, 0),
  ),
  false,
  "A configured closed date overrides regular hours",
);
assert.equal(
  helpPointApi.isOpenNow(
    makePoint({
      closedPeriods: [
        { start: "2026-02-03T12:00", end: "2026-02-03T13:00" },
      ],
    }),
    new Date(2026, 1, 3, 12, 30),
  ),
  false,
  "A configured closed time overrides regular hours",
);
assert.equal(
  helpPointApi.isOpenNow(
    makePoint({
      closedPeriods: [
        { start: "2026-02-03T12:00", end: "2026-02-03T13:00" },
      ],
    }),
    new Date(2026, 1, 3, 13, 0),
  ),
  true,
  "A closed-time range has an exclusive end",
);
assert.equal(
  helpPointApi.isOpenNow(
    makePoint({
      openingHours: [{ days: [1], opens: "22:00", closes: "02:00" }],
      closedPeriods: [
        { start: "2026-02-02T23:00", end: "2026-02-03T02:00" },
      ],
    }),
    new Date(2026, 1, 3, 1, 0),
  ),
  false,
  "A closed period crossing midnight remains closed on the next day",
);
assert.equal(
  helpPointApi.isOpenNow(
    makePoint({
      closedDates: ["2026-02-02"],
      openingHours: [{ days: [1], opens: "22:00", closes: "02:00" }],
    }),
    new Date(2026, 1, 3, 1, 0),
  ),
  false,
  "A closed date prevents its overnight hours extending into the next day",
);

assert.match(overview, /href="help-points\.html"[\s\S]*Find Help Points/);
assert.match(html, /href="index\.html">Back to overview/);
assert.match(html, /href="index\.html#page-title">Ask for help/);
assert.match(html, /id="open-now"/);
assert.match(html, /id="no-points"/);
assert.match(html, /id="no-open-points"/);
assert.match(html, /Help-point availability is unverified/);
assert.match(html, /Opening hours have not been verified/);
assert.doesNotMatch(source, /geolocation|navigator\.|getCurrentPosition/);

const app = setup();
assert.equal(app.get("#help-point-list").children.length, 3);
assert.match(app.get("#results-status").textContent, /3 help points listed/);
assert.match(app.get("#event-name").textContent, /Stratumseind, Eindhoven/);
assert.equal(app.get("#no-points").hidden, true);
assert.equal(app.get("#no-open-points").hidden, true);
app.clickPoint(0);
assert.match(getText(app.get("#help-point-details")), /Catharinaplein Help Point/);
assert.match(getText(app.get("#help-point-details")), /Detailed directions/);
assert.match(getText(app.get("#help-point-details")), /Landmarks/);
assert.match(getText(app.get("#help-point-details")), /Opening hours \(unverified\)/);
assert.equal(
  app.get("#help-point-list").querySelector('[data-point-id="catharinaplein"]').focused,
  true,
  "Selecting a help point retains keyboard focus",
);

app.clickPoint(2);
app.filterOpen(true);
assert.equal(app.get("#help-point-list").children.length, 2);
assert.match(app.get("#results-status").textContent, /2 help points listed and open now/);
assert.match(getText(app.get("#help-point-list")), /Catharinaplein Help Point/);
assert.match(getText(app.get("#help-point-list")), /Stratumseind Central Help Point/);
assert.doesNotMatch(getText(app.get("#help-point-list")), /Dommelbrug Help Point/);
assert.equal(
  app.get("#help-point-details").children[1].textContent,
  "Select a help point to see its details.",
  "Filtering out a selected point resets the detail prompt",
);

const noOpenPoints = setup({
  timestamp: new Date(2026, 11, 23, 3, 0).getTime(),
});
noOpenPoints.filterOpen(true);
assert.equal(noOpenPoints.get("#help-point-list").children.length, 0);
assert.equal(noOpenPoints.get("#no-open-points").hidden, false);
assert.equal(noOpenPoints.get("#no-points").hidden, true);
assert.match(noOpenPoints.get("#results-status").textContent, /No help points are open now/);

const noPoints = setup({ points: [] });
assert.equal(noPoints.get("#help-point-list").children.length, 0);
assert.equal(noPoints.get("#no-points").hidden, false);
assert.equal(noPoints.get("#no-open-points").hidden, true);
assert.match(noPoints.get("#results-status").textContent, /No help points are available/);

console.log("Help points tests passed.");

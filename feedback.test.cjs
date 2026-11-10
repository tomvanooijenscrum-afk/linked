const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
const source = read("feedback.js");
const storeSource = read("feedback-store.js");
const requestStoreSource = read("request-store.js");
const html = read("feedback.html");
const indexHtml = read("index.html");

function createStorage({ failWrites = false } = {}) {
  const values = new Map();
  return {
    values,
    failWrites,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (this.failWrites) {
        throw new Error("QuotaExceededError (test)");
      }
      values.set(key, value);
    },
  };
}

function createElement(extra = {}) {
  return {
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    checked: false,
    focused: false,
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    focus() {
      this.focused = true;
    },
    ...extra,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup(storage = createStorage()) {
  const selectors = [
    "#feedback-form",
    "#rating-group",
    "#rating-error",
    "#feedback-comment",
    "#comment-count",
    "#submit-button",
    "#feedback-failure",
    "#retry-button",
    "#feedback-confirmation",
    "#confirmation-title",
    "#simulate-failure",
  ];
  const elements = new Map();
  for (const selector of selectors) {
    assert.ok(
      html.includes(`id="${selector.slice(1)}"`),
      `Ontbreekt in feedback.html: ${selector}`,
    );
    elements.set(selector, createElement());
  }
  // Zelfde beginstand als de HTML.
  for (const hidden of ["#rating-error", "#feedback-failure", "#feedback-confirmation"]) {
    elements.get(hidden).hidden = true;
  }

  const ratings = [1, 2, 3, 4, 5].map((value) =>
    createElement({ value: String(value) }),
  );
  const categories = [
    "clarity",
    "ease-of-use",
    "technical-problems",
    "speed",
    "other",
  ].map((value) => createElement({ value }));

  const errors = [];
  const context = vm.createContext({
    localStorage: storage,
    console: { error: (...args) => errors.push(args) },
    Promise,
    document: {
      querySelector(selector) {
        assert.ok(elements.has(selector), `Onbekend element: ${selector}`);
        return elements.get(selector);
      },
      querySelectorAll(selector) {
        if (selector === 'input[name="rating"]') return ratings;
        if (selector === 'input[name="category"]') return categories;
        throw new Error(`Onbekende selector: ${selector}`);
      },
    },
  });
  vm.runInContext(requestStoreSource, context);
  vm.runInContext(storeSource, context);
  vm.runInContext(source, context);

  const get = (selector) => elements.get(selector);
  return {
    storage,
    errors,
    get,
    ratings,
    categories,
    store: context.LinkedFeedbackStore,
    requestStore: context.LinkedRequestStore,
    submit() {
      let prevented = false;
      get("#feedback-form").listeners.submit({
        preventDefault() {
          prevented = true;
        },
      });
      assert.ok(prevented, "Formulier mag de pagina niet herladen");
    },
    type(text) {
      get("#feedback-comment").value = text;
      get("#feedback-comment").listeners.input();
    },
    saved() {
      return context.LinkedFeedbackStore.getFeedback();
    },
  };
}

async function run() {
  // 1. Pagina-opbouw en menu-link.
  assert.ok(indexHtml.includes('href="feedback.html"'));
  assert.ok(indexHtml.includes("Give feedback"));
  for (const label of ["Very poor", "Poor", "Okay", "Good", "Very good"]) {
    assert.ok(html.includes(`<span class="rating-label">${label}</span>`));
  }
  for (const label of ["Clarity", "Ease of use", "Technical problems"]) {
    assert.ok(html.includes(`<span>${label}</span>`));
  }
  assert.equal(html.match(/name="rating"/g).length, 5);
  assert.ok(html.includes('maxlength="500"'));
  assert.ok(html.includes("don’t include your name"));
  assert.ok(html.includes('href="index.html">Leave without sending'));
  assert.ok(html.includes("novalidate"));
  console.log("Passed: page structure, labels, menu link and leave link.");

  // 2. Zonder beoordeling: melding, niets opgeslagen, invoer blijft.
  {
    const app = setup();
    assert.equal(app.get("#comment-count").textContent, "0 / 500 characters");
    app.categories[0].checked = true;
    app.type("The button text was unclear.");
    app.submit();
    await settle();
    assert.equal(app.get("#rating-error").hidden, false);
    assert.equal(app.get("#rating-group").attributes["aria-invalid"], "true");
    assert.equal(app.ratings[0].focused, true);
    assert.equal(app.saved().length, 0);
    assert.equal(app.get("#feedback-comment").value, "The button text was unclear.");
    assert.equal(app.categories[0].checked, true);
    assert.equal(app.get("#feedback-confirmation").hidden, true);

    // Kiezen van een beoordeling haalt de melding weg.
    app.ratings[3].checked = true;
    app.ratings[3].listeners.change();
    assert.equal(app.get("#rating-error").hidden, true);
    assert.equal(app.get("#rating-group").attributes["aria-invalid"], undefined);
  }
  console.log("Passed: missing rating shows a message and keeps input.");

  // 3. Geldige verzending bevat geen account, verzoek of locatie.
  {
    const app = setup();
    const request = app.requestStore.createRequest();
    app.requestStore.setApproximateLocation(request.id, {
      latitude: 51.4416,
      longitude: 5.4697,
    });
    app.ratings[4].checked = true;
    app.categories[1].checked = true;
    app.categories[2].checked = true;
    app.type("  Worked well.  ");
    app.submit();
    await settle();

    const saved = app.saved();
    assert.equal(saved.length, 1);
    assert.deepEqual(Object.keys(saved[0]).sort(), [
      "categories",
      "comment",
      "rating",
      "submittedAt",
    ]);
    assert.equal(saved[0].rating, 5);
    assert.deepEqual([...saved[0].categories], ["ease-of-use", "technical-problems"]);
    assert.equal(saved[0].comment, "Worked well.");
    assert.match(saved[0].submittedAt, /^\d{4}-\d{2}-\d{2}$/);

    const raw = app.storage.getItem(app.store.storageKey);
    assert.ok(!raw.includes(request.id), "Geen verzoek-id in feedback");
    assert.ok(!raw.includes("51.44"), "Geen locatie in feedback");
    assert.ok(!raw.includes("5.47"), "Geen locatie in feedback");
    // Het hulpverzoek zelf blijft onaangeroerd.
    assert.equal(app.requestStore.getRequest().status, "pending");

    // Bevestiging; formulier weg, dus niet opnieuw te verzenden.
    assert.equal(app.get("#feedback-confirmation").hidden, false);
    assert.equal(app.get("#feedback-form").hidden, true);
    assert.equal(app.get("#confirmation-title").focused, true);
    app.submit();
    app.get("#retry-button").listeners.click();
    await settle();
    assert.equal(app.saved().length, 1, "Geen tweede verzending na bevestiging");
  }
  console.log("Passed: anonymous submission, confirmation and no resend.");

  // 4. Tekenteller en maximale lengte.
  {
    const app = setup();
    app.type("a".repeat(500));
    assert.equal(app.get("#comment-count").textContent, "500 / 500 characters");
    app.ratings[2].checked = true;
    app.submit();
    await settle();
    assert.equal(app.saved()[0].comment.length, 500);

    assert.throws(
      () => app.store.buildFeedback({ rating: 3, comment: "a".repeat(501) }),
      /at most 500/,
    );
  }
  console.log("Passed: character counter and 500-character limit.");

  // 5. Snel herhaald klikken: één opgeslagen item.
  {
    const app = setup();
    app.ratings[1].checked = true;
    for (let click = 0; click < 10; click += 1) {
      app.submit();
    }
    assert.equal(app.get("#submit-button").disabled, true);
    assert.equal(app.get("#submit-button").textContent, "Sending…");
    await settle();
    assert.equal(app.saved().length, 1);
    assert.equal(app.get("#feedback-confirmation").hidden, false);
  }
  console.log("Passed: repeated clicks store one entry.");

  // 6. Mislukte opslag: invoer blijft, opnieuw proberen werkt.
  {
    const storage = createStorage({ failWrites: true });
    const app = setup(storage);
    app.ratings[0].checked = true;
    app.categories[2].checked = true;
    app.type("Map did not load.");
    app.submit();
    await settle();
    assert.equal(app.get("#feedback-failure").hidden, false);
    assert.equal(app.get("#retry-button").focused, true);
    assert.equal(app.get("#feedback-confirmation").hidden, true);
    assert.equal(app.get("#feedback-form").hidden, false);
    assert.equal(app.get("#submit-button").disabled, false);
    assert.equal(app.get("#submit-button").textContent, "Send feedback");
    assert.equal(app.ratings[0].checked, true);
    assert.equal(app.categories[2].checked, true);
    assert.equal(app.get("#feedback-comment").value, "Map did not load.");
    assert.equal(app.saved().length, 0);

    storage.failWrites = false;
    app.get("#retry-button").listeners.click();
    await settle();
    assert.equal(app.get("#feedback-failure").hidden, true);
    assert.equal(app.get("#feedback-confirmation").hidden, false);
    assert.equal(app.saved().length, 1);
    assert.equal(app.saved()[0].comment, "Map did not load.");
  }
  console.log("Passed: failed submission keeps input and retry succeeds.");

  // 7. Gesimuleerde fout via demo-optie.
  {
    const app = setup();
    app.get("#simulate-failure").checked = true;
    app.ratings[2].checked = true;
    app.submit();
    await settle();
    assert.equal(app.get("#feedback-failure").hidden, false);
    assert.equal(app.saved().length, 0);
    app.get("#simulate-failure").checked = false;
    app.get("#retry-button").listeners.click();
    await settle();
    assert.equal(app.saved().length, 1);
  }
  console.log("Passed: demo failure toggle and retry.");

  // 8. Validatie in de opslagmodule.
  {
    const { store } = setup();
    for (const rating of [undefined, null, 0, 6, 2.5, "x"]) {
      assert.throws(() => store.buildFeedback({ rating }), /rating/);
    }
    assert.throws(
      () => store.buildFeedback({ rating: 3, categories: ["name"] }),
      /Unknown feedback category/,
    );
    const entry = store.buildFeedback({
      rating: "4",
      categories: ["other", "clarity", "clarity"],
      requestId: "abc",
      approximateLocation: { latitude: 51.44, longitude: 5.47 },
      accountId: "user-1",
    });
    assert.deepEqual(Object.keys(entry).sort(), [
      "categories",
      "comment",
      "rating",
      "submittedAt",
    ]);
    assert.equal(entry.rating, 4);
    assert.deepEqual([...entry.categories], ["clarity", "other"]);
    assert.equal(entry.comment, "");
  }
  console.log("Passed: store validation and field whitelist.");

  // 9. Beschadigde opslag wordt genegeerd in plaats van te crashen.
  {
    const storage = createStorage();
    storage.values.set("linked.feedback.v1", "{not json");
    const app = setup(storage);
    assert.equal(app.saved().length, 0);
    app.ratings[4].checked = true;
    app.submit();
    await settle();
    assert.equal(app.saved().length, 1);
  }
  console.log("Passed: corrupt saved feedback is replaced safely.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

((global) => {
  // Eigen sleutel: feedback staat los van hulpverzoeken en beschikbaarheid.
  const storageKey = "linked.feedback.v1";
  const maxEntries = 50;
  const maxCommentLength = 500;

  const ratings = Object.freeze([
    Object.freeze({ value: 1, label: "Very poor" }),
    Object.freeze({ value: 2, label: "Poor" }),
    Object.freeze({ value: 3, label: "Okay" }),
    Object.freeze({ value: 4, label: "Good" }),
    Object.freeze({ value: 5, label: "Very good" }),
  ]);

  const categories = Object.freeze([
    Object.freeze({ value: "clarity", label: "Clarity" }),
    Object.freeze({ value: "ease-of-use", label: "Ease of use" }),
    Object.freeze({ value: "technical-problems", label: "Technical problems" }),
    Object.freeze({ value: "speed", label: "Response speed" }),
    Object.freeze({ value: "other", label: "Other" }),
  ]);

  const validCategories = new Set(categories.map((item) => item.value));

  // Alleen de dag, geen tijdstip: zo is feedback niet aan een verzoek te
  // koppelen via het moment van indienen.
  function getSubmittedDay(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
  }

  // Bouwt een feedbackitem uit een vaste lijst velden. Wat er verder in de
  // invoer staat (verzoek-id, locatie, account) wordt nooit overgenomen.
  function buildFeedback(input) {
    const rating = Number(input && input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error("A rating from 1 to 5 is required.");
    }

    const chosenCategories = Array.isArray(input.categories)
      ? input.categories
      : [];
    for (const category of chosenCategories) {
      if (!validCategories.has(category)) {
        throw new Error(`Unknown feedback category: ${category}`);
      }
    }

    const comment =
      typeof input.comment === "string" ? input.comment.trim() : "";
    if (comment.length > maxCommentLength) {
      throw new Error(`The comment can be at most ${maxCommentLength} characters.`);
    }

    return {
      rating,
      // Vaste volgorde en geen dubbele waarden.
      categories: categories
        .map((item) => item.value)
        .filter((value) => chosenCategories.includes(value)),
      comment,
      submittedAt: getSubmittedDay(),
    };
  }

  function getFeedback() {
    let stored;
    try {
      stored = global.localStorage.getItem(storageKey);
    } catch (error) {
      console.error("Could not read the saved feedback.", error);
      return [];
    }
    if (stored === null) {
      return [];
    }

    try {
      const list = JSON.parse(stored);
      return Array.isArray(list) ? list : [];
    } catch (error) {
      console.error("The saved feedback has an invalid format.", error);
      return [];
    }
  }

  // Asynchroon, zodat een latere echte backend dezelfde vorm kan houden.
  // Een opslagfout (vol, geblokkeerd) wordt een mislukte verzending.
  function submitFeedback(input) {
    return new Promise((resolve) => {
      const entry = buildFeedback(input);
      const list = [...getFeedback(), entry].slice(-maxEntries);
      global.localStorage.setItem(storageKey, JSON.stringify(list));
      resolve(entry);
    });
  }

  global.LinkedFeedbackStore = Object.freeze({
    storageKey,
    maxCommentLength,
    ratings,
    categories,
    buildFeedback,
    getFeedback,
    submitFeedback,
  });
})(globalThis);

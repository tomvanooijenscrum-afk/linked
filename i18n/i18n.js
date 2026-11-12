// Reusable translation helper for the requester interface.
// Usage: LinkedI18n.t("request.button"), LinkedI18n.t("location.near", { place: "Park" })
// Static HTML text uses data-i18n="key" and data-i18n-aria-label="key".
((global) => {
  const storageKey = "linked.language";
  const defaultLanguage = "en";
  const supportedLanguages = ["en", "nl"];
  const listeners = [];
  const warned = new Set();
  let language = readSavedLanguage();

  function isSupported(value) {
    return supportedLanguages.includes(value);
  }

  function readSavedLanguage() {
    try {
      const saved = global.localStorage.getItem(storageKey);
      return isSupported(saved) ? saved : defaultLanguage;
    } catch {
      return defaultLanguage;
    }
  }

  function saveLanguage(value) {
    try {
      global.localStorage.setItem(storageKey, value);
    } catch {
      // The language still changes for this visit when storage is blocked.
    }
  }

  function lookup(key, code) {
    const dictionary = (global.LinkedTranslations || {})[code];
    return dictionary && Object.hasOwn(dictionary, key)
      ? dictionary[key]
      : undefined;
  }

  function warnOnce(message) {
    if (!warned.has(message)) {
      warned.add(message);
      console.warn(message);
    }
  }

  function t(key, params) {
    let text = lookup(key, language);
    if (text === undefined) {
      warnOnce(`Missing ${language} translation for "${key}".`);
      text = lookup(key, defaultLanguage);
    }
    if (text === undefined) {
      warnOnce(`Missing translation key "${key}".`);
      return key;
    }
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      params && Object.hasOwn(params, name) ? String(params[name]) : match,
    );
  }

  function applyStaticText() {
    const doc = global.document;
    if (!doc) {
      return;
    }
    if (doc.documentElement) {
      doc.documentElement.lang = language;
    }
    if (typeof doc.querySelectorAll === "function") {
      for (const element of doc.querySelectorAll("[data-i18n]")) {
        element.textContent = t(element.getAttribute("data-i18n"));
      }
      for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute(
          "aria-label",
          t(element.getAttribute("data-i18n-aria-label")),
        );
      }
    }
    if (typeof doc.title === "string" && lookup("page.title", language)) {
      doc.title = t("page.title");
    }
  }

  function notify() {
    applyStaticText();
    for (const listener of listeners) {
      listener(language);
    }
  }

  function setLanguage(value) {
    if (!isSupported(value)) {
      return false;
    }
    language = value;
    saveLanguage(value);
    notify();
    return true;
  }

  // Re-reads the saved language, for example after a change in another tab.
  function reload() {
    const saved = readSavedLanguage();
    if (saved !== language) {
      language = saved;
      notify();
    }
  }

  function onChange(listener) {
    listeners.push(listener);
  }

  global.LinkedI18n = Object.freeze({
    t,
    setLanguage,
    reload,
    onChange,
    applyStaticText,
    getLanguage: () => language,
    supportedLanguages,
    defaultLanguage,
    storageKey,
  });

  applyStaticText();
})(globalThis);
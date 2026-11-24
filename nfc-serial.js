// Web Serial-verbinding met de Linked NFC-firmware (v2) op een Arduino Uno.
// Protocol: zie nfc/PROTOCOL.md. Elke opdracht is één regel; het antwoord
// begint met CMD:<naam> en eindigt met precies één SUCCESS:- of ERROR:-regel.
//
// Alle methoden geven een object { ok, error?, ... } terug en gooien geen
// fouten, zodat de interface elke fout als foutcode kan tonen.
((global) => {
  const baudRate = 115200;
  const protocolVersion = "2";
  // Langste opdracht: WRITE:<14>:REPLACE:https://<136> = 173 tekens.
  const maxCommandLength = 179;
  const maxLineLength = 512;
  const maxUrlSuffix = 136;
  const defaultTimeouts = {
    ready: 4000,
    PING: 2500,
    VERSION: 2500,
    SCAN: 6000,
    INFO: 8000,
    READ: 8000,
    WRITE: 15000,
  };

  function isSupported(
    navigator = global.navigator,
    secure = global.isSecureContext,
  ) {
    return Boolean(secure && navigator && navigator.serial);
  }

  function parseResponse(lines) {
    const result = { ok: false, lines };

    for (const line of lines) {
      if (line.startsWith("UID:")) result.uid = line.slice(4);
      else if (line.startsWith("TYPE:")) result.type = line.slice(5);
      else if (line.startsWith("LOCKED:")) result.locked = line === "LOCKED:1";
      else if (line.startsWith("NDEF:")) result.ndef = line.slice(5);
      else if (line.startsWith("URL:")) result.url = line.slice(4);
    }

    const last = lines.at(-1) ?? "";
    if (last.startsWith("SUCCESS:")) {
      result.ok = true;
      result.result = last.slice(8);
      for (const prefix of ["URL:", "WRITTEN:"]) {
        if (result.result.startsWith(prefix)) {
          result.url = result.result.slice(prefix.length);
        }
      }
      if (result.result.startsWith("VERSION:")) {
        result.version = result.result.split(":").at(-1);
      }
    } else if (last.startsWith("ERROR:")) {
      result.error = last.slice(6);
    } else {
      result.error = "INCOMPLETE_RESPONSE";
    }

    return result;
  }

  function checkUrl(url) {
    if (typeof url !== "string" || !url.startsWith("https://")) {
      return "HTTPS_REQUIRED";
    }
    const suffix = url.slice("https://".length);
    if (suffix.length === 0 || !/^[\x21-\x7e]+$/.test(suffix)) {
      return "INVALID_URL";
    }
    if (suffix.length > maxUrlSuffix) return "URL_TOO_LONG";
    return null;
  }

  // Zet een fout van de Web Serial API om naar een vaste foutcode.
  function portErrorCode(error, fallback) {
    switch (error && error.name) {
      case "NotFoundError":
        return "NO_PORT_SELECTED";
      case "SecurityError":
        return "PERMISSION_DENIED";
      case "InvalidStateError":
        return "PORT_ALREADY_OPEN";
      case "NetworkError":
        return "PORT_BUSY";
      default:
        return fallback;
    }
  }

  function createReader({
    serial = global.navigator && global.navigator.serial,
    secure = global.isSecureContext,
    onEvent = () => {},
    timeouts = {},
  } = {}) {
    const limits = { ...defaultTimeouts, ...timeouts };
    const encoder = new TextEncoder();

    let port = null;
    let state = "disconnected";
    let lineBuffer = "";
    let discardingLine = false;
    let pending = null;
    let readyWaiter = null;
    let streamReader = null;
    let readLoop = null;
    let closing = false;
    // Antwoorden van opdrachten die al zijn verlopen, worden overgeslagen
    // zodat ze nooit bij de volgende opdracht terechtkomen.
    let staleAnswers = 0;
    let queue = Promise.resolve();

    function setState(next, reason) {
      state = next;
      onEvent({ type: "state", state: next, reason });
    }

    function finishPending(result) {
      if (!pending) return;
      const { resolve, timer } = pending;
      clearTimeout(timer);
      pending = null;
      resolve(result);
    }

    function handleLine(line) {
      if (line.startsWith("READY:")) {
        staleAnswers = 0;
        if (readyWaiter) {
          readyWaiter(line);
          readyWaiter = null;
        } else if (pending) {
          // De Arduino herstartte midden in een opdracht.
          finishPending({ ok: false, error: "READER_RESET", lines: pending.lines });
        }
        return;
      }

      const isFinal = line.startsWith("SUCCESS:") || line.startsWith("ERROR:");

      if (staleAnswers > 0) {
        if (isFinal) staleAnswers -= 1;
        return;
      }
      if (!pending) return;

      // Pas na de echo CMD:<naam> hoort een regel bij deze opdracht; losse
      // meldingen (bijv. ERROR:INCOMPLETE_COMMAND) daarvoor worden genegeerd.
      if (line.startsWith("CMD:")) {
        pending.started = line === `CMD:${pending.name}`;
        return;
      }
      if (!pending.started) return;

      if (line.startsWith("STATUS:")) {
        onEvent({ type: "progress", step: line.slice(7) });
      }
      pending.lines.push(line);
      if (isFinal) finishPending(parseResponse(pending.lines));
    }

    function handleText(text) {
      lineBuffer += text;
      const parts = lineBuffer.split("\n");
      lineBuffer = parts.pop();
      for (const part of parts) {
        const tooLong = discardingLine || part.length > maxLineLength;
        discardingLine = false;
        const line = part.replace(/\r$/, "").trim();
        if (line && !tooLong) handleLine(line);
      }
      // Een te lange regel zonder einde: de rest tot de newline weggooien.
      if (lineBuffer.length > maxLineLength) {
        lineBuffer = "";
        discardingLine = true;
      }
    }

    async function runReadLoop(openedPort) {
      const decoder = new TextDecoder();
      // Niet-fatale fouten (bijv. een framing error) laten readable bestaan.
      while (openedPort.readable && !closing) {
        streamReader = openedPort.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await streamReader.read();
            if (done) break;
            handleText(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          console.error("Serial read error.", error);
        } finally {
          streamReader.releaseLock();
          streamReader = null;
        }
        if (closing) break;
      }
      if (!closing) lost("READER_DISCONNECTED");
    }

    function lost(reason) {
      if (state === "disconnected") return;
      closing = true;
      readyWaiter = null;
      finishPending({ ok: false, error: reason, lines: pending ? pending.lines : [] });
      const lostPort = port;
      const lostReader = streamReader;
      const lostLoop = readLoop;
      port = null;
      setState("disconnected", reason);
      // Eerst de lees-stream loslaten, anders weigert close().
      (async () => {
        if (lostReader) await lostReader.cancel().catch(() => {});
        if (lostLoop) await lostLoop;
        if (lostPort) await lostPort.close().catch(() => {});
      })();
    }

    function onSerialDisconnect(event) {
      if (port && event.target === port) lost("READER_DISCONNECTED");
    }

    async function writeLine(text) {
      const writer = port.writable.getWriter();
      try {
        await writer.write(encoder.encode(`${text}\n`));
      } finally {
        writer.releaseLock();
      }
    }

    async function execute(command) {
      if (state !== "connected" && state !== "connecting") {
        return { ok: false, error: "NOT_CONNECTED", lines: [] };
      }
      const name = command.split(":")[0];
      const result = new Promise((resolve) => {
        pending = { name, started: false, lines: [], resolve, timer: null };
        pending.timer = setTimeout(() => {
          pending = null;
          staleAnswers += 1;
          resolve({ ok: false, error: "TIMEOUT", lines: [] });
          // Twee verlopen opdrachten op rij: de firmware reageert niet meer.
          if (staleAnswers >= 2) lost("READER_NOT_RESPONDING");
        }, limits[name] ?? limits.WRITE);
      });
      try {
        await writeLine(command);
      } catch (error) {
        console.error("Serial write error.", error);
        lost("READER_DISCONNECTED");
      }
      return result;
    }

    function send(command) {
      if (
        typeof command !== "string" ||
        command.length === 0 ||
        command.length > maxCommandLength ||
        /[\r\n]/.test(command)
      ) {
        return Promise.resolve({ ok: false, error: "INVALID_COMMAND", lines: [] });
      }
      // Eén opdracht tegelijk: de firmware verwerkt ze na elkaar.
      const run = queue.then(() => execute(command));
      queue = run.catch(() => {});
      return run;
    }

    function waitForReady() {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          readyWaiter = null;
          resolve(null);
        }, limits.ready);
        readyWaiter = (line) => {
          clearTimeout(timer);
          resolve(line);
        };
      });
    }

    async function fail(error) {
      closing = true;
      const failedPort = port;
      port = null;
      if (streamReader) await streamReader.cancel().catch(() => {});
      if (readLoop) await readLoop;
      if (failedPort) await failedPort.close().catch(() => {});
      setState("disconnected", error);
      return { ok: false, error };
    }

    async function connect() {
      if (!isSupported({ serial }, secure)) {
        return { ok: false, error: "UNSUPPORTED_BROWSER" };
      }
      if (state !== "disconnected") {
        return { ok: false, error: "ALREADY_CONNECTED" };
      }

      setState("connecting");
      let selected;
      try {
        // Geen filter: veel Uno-klonen hebben een CH340-chip met een
        // andere USB-vendor-ID dan een originele Uno.
        selected = await serial.requestPort();
      } catch (error) {
        setState("disconnected");
        return { ok: false, error: portErrorCode(error, "NO_PORT_SELECTED") };
      }

      try {
        await selected.open({ baudRate });
      } catch (error) {
        setState("disconnected");
        return { ok: false, error: portErrorCode(error, "PORT_BUSY") };
      }

      port = selected;
      closing = false;
      lineBuffer = "";
      discardingLine = false;
      staleAnswers = 0;
      queue = Promise.resolve();
      const ready = waitForReady();
      readLoop = runReadLoop(selected);

      // De Uno herstart bij het openen van de poort en meldt READY.
      const readyLine = await ready;
      if (state === "disconnected") return { ok: false, error: "READER_DISCONNECTED" };
      if (readyLine && readyLine.endsWith(":NO_READER")) {
        return fail("PN532_NOT_FOUND");
      }

      const version = await send("VERSION");
      if (!version.ok) {
        return fail(
          version.error === "UNKNOWN_COMMAND" || version.error === "TIMEOUT"
            ? "FIRMWARE_OUTDATED"
            : version.error,
        );
      }
      if (version.version !== protocolVersion) return fail("FIRMWARE_OUTDATED");

      const ping = await send("PING");
      if (!ping.ok) return fail(ping.error);

      setState("connected");
      return { ok: true, version: version.version };
    }

    async function disconnect() {
      if (state === "disconnected") return { ok: true };
      closing = true;
      finishPending({ ok: false, error: "DISCONNECTED", lines: [] });
      const closingPort = port;
      port = null;
      if (streamReader) await streamReader.cancel().catch(() => {});
      if (readLoop) await readLoop;
      if (closingPort) await closingPort.close().catch(() => {});
      setState("disconnected");
      return { ok: true };
    }

    if (serial && serial.addEventListener) {
      serial.addEventListener("disconnect", onSerialDisconnect);
    }

    return Object.freeze({
      connect,
      disconnect,
      send,
      get state() {
        return state;
      },
      ping: () => send("PING"),
      scan: () => send("SCAN"),
      info: () => send("INFO"),
      read: () => send("READ"),
      write(uid, url, { replace = false } = {}) {
        const urlError = checkUrl(url);
        if (urlError) return Promise.resolve({ ok: false, error: urlError, lines: [] });
        if (!/^[0-9A-F]{14}$/.test(uid ?? "")) {
          return Promise.resolve({ ok: false, error: "INVALID_UID", lines: [] });
        }
        return send(`WRITE:${uid}:${replace ? "REPLACE" : "BLANK"}:${url}`);
      },
    });
  }

  global.LinkedNfcSerial = Object.freeze({
    isSupported,
    parseResponse,
    checkUrl,
    createReader,
    maxUrlSuffix,
  });
})(globalThis);

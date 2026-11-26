// Test van confetti.js (baanberekening, opruimen, minder beweging).
//   node confetti.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "confetti.js"), "utf8");

function setup({ reducedMotion = false } = {}) {
  const timers = [];
  const body = { children: [], append(node) { this.children.push(node); } };
  function createElement() {
    return {
      style: {},
      attributes: {},
      children: [],
      animations: [],
      setAttribute(name, value) { this.attributes[name] = value; },
      append(node) { this.children.push(node); },
      animate(frames, options) { this.animations.push({ frames, options }); },
      remove() { body.children = body.children.filter((node) => node !== this); },
    };
  }
  const context = vm.createContext({
    Math,
    innerWidth: 400,
    innerHeight: 800,
    matchMedia: (query) => ({ matches: reducedMotion && query.includes("reduce") }),
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
    document: { body, createElement },
  });
  vm.runInContext(source, context);
  return { confetti: context.LinkedConfetti, body, timers };
}

// 1. Baan: 41 keyframes, begint op de oorsprong, valt en vervaagt.
const { confetti, body, timers } = setup();
const frames = confetti.buildKeyframes({
  angle: -Math.PI / 2, startVelocity: 25, decay: 0.91, gravity: 1, drift: 0,
  wobbleSpeed: 0.1, wobbleOffset: 0, size: 1, ticks: 150, tiltRotations: 3, rotation: 0,
});
assert.equal(frames.length, 41);
assert.ok(frames[0].transform.startsWith("translate(0px, 0px) scale(0)"));
assert.equal(frames[0].opacity, 1);
assert.ok(Math.abs(frames.at(-1).opacity) < 1e-9, "Eindigt onzichtbaar");
const lastY = Number(frames.at(-1).transform.match(/translate\([^,]+, ([-\d.]+)px/)[1]);
assert.ok(lastY > 0, "Zwaartekracht trekt de deeltjes uiteindelijk naar beneden");

// 2. Afvuren vanuit een element: één laag, 80 deeltjes, daarna opgeruimd.
const origin = { getBoundingClientRect: () => ({ left: 100, top: 200, width: 200, height: 40 }) };
assert.equal(confetti.fire(origin), true);
assert.equal(body.children.length, 1);
const stage = body.children[0];
assert.equal(stage.className, "confetti-stage");
assert.equal(stage.attributes["aria-hidden"], "true", "Verborgen voor schermlezers");
assert.equal(stage.children.length, 80);
assert.equal(stage.children[0].style.left, "200px");
assert.equal(stage.children[0].style.top, "220px");
assert.equal(stage.children[0].animations[0].options.duration, 2500);
assert.equal(timers[0].delay, 3000);
timers[0].callback();
assert.equal(body.children.length, 0, "Laag na afloop verwijderd");

// 3. Minder beweging gevraagd: geen confetti.
const calm = setup({ reducedMotion: true });
assert.equal(calm.confetti.fire(origin), false);
assert.equal(calm.body.children.length, 0);

console.log("Passed: trajectory, burst from the status message, cleanup, reduced motion.");

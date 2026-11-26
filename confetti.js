// Confetti als een vrijwilliger de aanvraag accepteert. Zelfde natuurkunde
// als een canvas-confetti-burst, maar met losse elementen en de Web
// Animations API, zodat er geen library of build-stap nodig is.
(function () {
  const colors = ["#26ccff", "#a25afd", "#ff5e7e", "#88ff5a", "#fcff42", "#ffa62d", "#ff36ff"];
  const shapes = ["circle", "rect", "rect", "strip", "strip"];
  const keyframeCount = 40;
  const popWindow = 0.08;

  const defaults = {
    particleCount: 80,
    startVelocity: 25,
    spread: 100,
    decay: 0.91,
    gravity: 1,
    drift: 0,
    duration: 2.5,
    size: 1,
  };

  // Rekent de baan van één deeltje uit en geeft keyframes terug.
  function buildKeyframes({
    angle,
    startVelocity,
    decay,
    gravity,
    drift,
    wobbleSpeed,
    wobbleOffset,
    size,
    ticks,
    tiltRotations,
    rotation,
  }) {
    const frames = [];
    let velocity = startVelocity;
    let x = 0;
    let y = 0;
    let wobble = wobbleOffset;
    let tick = 0;

    for (let i = 0; i <= keyframeCount; i += 1) {
      const t = i / keyframeCount;
      if (i > 0) {
        const targetTick = Math.round((i * ticks) / keyframeCount);
        while (tick < targetTick) {
          x += Math.cos(angle) * velocity + drift;
          y += Math.sin(angle) * velocity + gravity * 3;
          velocity *= decay;
          wobble += wobbleSpeed;
          tick += 1;
        }
      }
      const translateX = i === 0 ? 0 : x + Math.cos(wobble) * 15 * size;
      let scale;
      if (t < popWindow * 0.6) scale = (t / (popWindow * 0.6)) * 1.15;
      else if (t < popWindow) scale = 1.15 - ((t - popWindow * 0.6) / (popWindow * 0.4)) * 0.15;
      else scale = 1;
      let opacity;
      if (t <= 0.5) opacity = 1;
      else if (t <= 0.8) opacity = 1 - ((t - 0.5) / 0.3) * 0.5;
      else opacity = 0.5 - ((t - 0.8) / 0.2) * 0.5;
      frames.push({
        transform:
          `translate(${translateX}px, ${y}px) scale(${scale}) ` +
          `rotateY(${tiltRotations * 360 * t}deg) rotate(${rotation}deg)`,
        opacity,
      });
    }
    return frames;
  }

  function prefersReducedMotion() {
    return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }

  // Schiet één burst af vanuit het midden van `origin` (of bovenin het scherm).
  // Geeft false terug als er niets getoond wordt.
  function fire(origin, options = {}) {
    if (prefersReducedMotion() || typeof document.createElement !== "function") {
      return false;
    }
    const settings = { ...defaults, ...options };
    const box = origin?.getBoundingClientRect?.();
    const originX = box ? box.left + box.width / 2 : globalThis.innerWidth / 2;
    const originY = box ? box.top + box.height / 2 : globalThis.innerHeight / 3;

    const stage = document.createElement("div");
    stage.className = "confetti-stage";
    stage.setAttribute("aria-hidden", "true");
    document.body.append(stage);

    const ticks = Math.round(settings.duration * 60);
    const spreadRad = settings.spread * (Math.PI / 180);
    for (let index = 0; index < settings.particleCount; index += 1) {
      const angle = -Math.PI / 2 + (0.5 * spreadRad - Math.random() * spreadRad);
      const velocity = settings.startVelocity * 0.5 + Math.random() * settings.startVelocity;
      const size = 6 * settings.size + Math.random() * 6 * settings.size;
      const shape = shapes[Math.floor(Math.random() * shapes.length)];

      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = `${originX}px`;
      piece.style.top = `${originY}px`;
      piece.style.width = `${shape === "strip" ? size * 0.3 : shape === "rect" ? size * 0.7 : size}px`;
      piece.style.height = `${shape === "strip" ? size * 2 : size}px`;
      piece.style.borderRadius =
        shape === "circle" ? "50%" : shape === "strip" ? `${size * 0.12}px` : "2px";
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      stage.append(piece);

      piece.animate(
        buildKeyframes({
          angle,
          startVelocity: velocity,
          decay: settings.decay,
          gravity: settings.gravity,
          drift: settings.drift,
          wobbleSpeed: Math.min(0.11, Math.random() * 0.1 + 0.05),
          wobbleOffset: Math.random() * 10,
          size: settings.size,
          ticks,
          tiltRotations: 2 + Math.random() * 4,
          rotation: Math.random() * 360,
        }),
        { duration: settings.duration * 1000, easing: "linear", fill: "forwards" },
      );
    }

    setTimeout(() => stage.remove(), (settings.duration + 0.5) * 1000);
    return true;
  }

  globalThis.LinkedConfetti = { fire, buildKeyframes };
})();

import { CARDS, LEVELS, advanceLevel, createGame, getObjective, restartLevel, tick } from "./rules.js";

const canvas = document.getElementById("garden");
const context = canvas.getContext("2d");
const scene = document.getElementById("scene");
const objective = document.getElementById("objective");
const feedback = document.getElementById("feedback");
const stageNumber = document.getElementById("stage-number");
const stageTitle = document.getElementById("stage-title");
const sparkCount = document.getElementById("spark-count");
const cardButton = document.getElementById("arcana");
const cardArt = document.getElementById("card-art");
const cardName = document.getElementById("card-name");
const cardPower = document.getElementById("card-power");
const cardStatus = document.getElementById("card-state");
const victory = document.getElementById("victory");
const victoryTitle = document.getElementById("victory-title");
const victoryDetail = document.getElementById("victory-detail");
const nextAction = document.getElementById("next-action");
const touches = [...document.querySelectorAll(".touch-controls button")];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const TILE = 18;
const VIEW_HEIGHT = 237.5;
const WIDE_VIEW = 550;
const STEP = 1 / 60;
const sparksPerLevel = LEVELS.map(({ rows }) =>
  rows.reduce((total, row) => total + row.split("*").length - 1, 0)
);
const keyActions = {
  a: "left", arrowleft: "left",
  d: "right", arrowright: "right",
  " ": "jump", spacebar: "jump", arrowup: "jump", w: "jump",
  e: "use", "1": "use",
};

const palettes = {
  garden: {
    sky: ["#191932", "#453b59", "#a27985"],
    distant: "#5d4968", middle: "#383552", near: "#272e40",
    soil: "#333642", stone: "#44464f", shade: "#262938",
    top: "#9eae81", second: "#5e775f", detail: "#64605e",
    light: "#e3ceff", glow: "#a48adf",
  },
  crypt: {
    sky: ["#1b152e", "#43324d", "#80576a"],
    distant: "#5b415b", middle: "#3f304c", near: "#30253e",
    soil: "#493241", stone: "#5b3d4d", shade: "#302638",
    top: "#c7a181", second: "#916a67", detail: "#805e68",
    light: "#ffdab3", glow: "#eb966e",
  },
  observatory: {
    sky: ["#151a36", "#30385c", "#6f7799"],
    distant: "#4e5779", middle: "#334269", near: "#243454",
    soil: "#333e58", stone: "#405371", shade: "#29314a",
    top: "#a0cdc6", second: "#638d96", detail: "#586a86",
    light: "#f7e6a7", glow: "#a1e5df",
  },
};

let state = createGame();
let cameraX = 0;
let viewWidth = WIDE_VIEW;
let lastFrame;
let accumulator = 0;
let shownLevel = -1;
const keyboard = new Map();
const pointers = new Map();
const queued = new Set();
const movementPulse = { left: 0, right: 0 };

function rect(color, x, y, width, height) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), width, height);
}

function pixelPath(color, x, y, points) {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x + points[0][0], y + points[0][1]);
  for (const [dx, dy] of points.slice(1)) context.lineTo(x + dx, y + dy);
  context.closePath();
  context.fill();
}

function randomAt(x, y, seed = 0) {
  const mixed = Math.imul(x + seed * 17, 374761393) ^ Math.imul(y + seed, 668265263);
  return ((mixed ^ (mixed >>> 13)) >>> 0) / 4294967296;
}

function sparkle(x, y, color, size = 2) {
  rect(color, x - size, y, size * 2 + 1, 1);
  rect(color, x, y - size, 1, size * 2 + 1);
  rect("#fff4dd", x, y, 1, 1);
}

function halo(color, x, y, radius) {
  const glow = context.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "#0000");
  context.fillStyle = glow;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function paintBackground(theme, palette, time) {
  const sky = context.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
  for (const [i, color] of palette.sky.entries()) sky.addColorStop(i / 2, color);
  rect(sky, 0, 0, viewWidth + 1, VIEW_HEIGHT);

  for (let i = 0; i < 116; i++) {
    const x = randomAt(i, 19, 5) * 735 - cameraX * .05;
    const y = 9 + randomAt(29, i, 11) * 130;
    const bright = Math.sin(time / 1100 + i * 1.7) > .6;
    rect(bright ? "#f8e4cbe5" : "#d6c9df80", x, y, 1, 1);
    if (i % 22 === 0) sparkle(x, y, "#f1dfc0", 2);
  }

  const moonX = viewWidth * .76 - cameraX * .10;
  const moonY = 60;
  halo(palette.light + "55", moonX, moonY, 62);
  context.beginPath();
  context.arc(moonX, moonY, theme === "garden" ? 32 : 25, 0, Math.PI * 2);
  context.fillStyle = palette.light;
  context.fill();

  const hills = [
    { color: palette.distant, speed: .15, height: 120, span: 98 },
    { color: palette.middle, speed: .28, height: 148, span: 77 },
    { color: palette.near, speed: .44, height: 170, span: 67 },
  ];
  for (const [layer, hill] of hills.entries()) {
    const offset = cameraX * hill.speed;
    const start = Math.floor(offset / hill.span);
    for (let i = start - 1; i < start + 2 + viewWidth / hill.span; i++) {
      const lift = Math.floor(randomAt(i, layer, 5) * 32);
      pixelPath(hill.color, Math.floor(i * hill.span - offset), hill.height, [
        [0, 20], [12, 8], [27, -lift], [43, 3 - lift], [hill.span, 20],
        [hill.span + 4, 99], [0, 99],
      ]);
    }
  }
}

function drawTerrain(tile, x, y, column, row, rows, palette) {
  const top = !"#=B".includes(rows[row - 1]?.[column] ?? ".");
  switch (tile) {
    case "#":
    case "=":
      rect(palette.shade, x, y, TILE, TILE);
      rect(tile === "=" ? palette.stone : palette.soil, x + 1, y + 2, TILE - 2, TILE - 3);
      if (top) {
        rect(palette.top, x, y, TILE, 2);
        rect(palette.second, x, y + 2, TILE, 3);
      }
      rect(palette.detail, x + 4, y + 9, 2 + Math.floor(randomAt(column, row) * 8), 1);
      break;
    case "^":
      for (let i = 0; i < TILE; i += 6) {
        pixelPath("#ad7892", x + i, y + 6, [[0, 12], [3, 0], [6, 12]]);
        pixelPath("#f5bdd0", x + i, y + 6, [[0, 12], [3, 0], [3, 8]]);
      }
      break;
    case "M":
      if (state.powerUsed) {
        rect("#433b72", x, y, TILE, TILE);
        rect("#bdabff", x, y, TILE, 2);
        rect("#786aad", x + 1, y + 8, TILE - 2, 1);
        sparkle(x + TILE / 2, y + 9, "#aa9ae7");
      } else {
        rect("#b2a3ef70", x + 2, y + 2, TILE - 4, 1);
        rect("#b2a3ef55", x + 3, y + 14, TILE - 6, 1);
        sparkle(x + TILE / 2, y + 8, "#9c91c8");
      }
      break;
    case "B":
      if (!state.powerUsed) {
        rect("#4a3042", x, y, TILE, TILE);
        rect("#875b61", x + 1, y + 1, TILE - 2, TILE - 2);
        rect("#c59081", x + 1, y + 1, TILE - 2, 2);
        pixelPath("#492b41", x, y, [[6, 0], [10, 6], [8, 10], [12, 18], [10, 18], [6, 10], [8, 6]]);
      }
      break;
  }
}

function drawFeature(tile, x, y, column, row, palette, time) {
  const center = x + TILE / 2;
  switch (tile) {
    case "C": {
      if (state.cardFound) return;
      const shift = Math.round(Math.sin(time / 330) * 2);
      halo(palette.glow + "88", center, y + 8, 21);
      rect("#4a365d", center - 7, y - 4 + shift, 14, 21);
      rect(palette.light, center - 6, y - 4 + shift, 12, 19);
      rect("#4a365d", center - 5, y - 3 + shift, 10, 17);
      sparkle(center, y + 5 + shift, palette.light, 3);
      break;
    }
    case "*":
      if (!state.collected.includes(`${column},${row}`)) {
        sparkle(center, y + 9, "#edc481", 2);
      }
      break;
    case "K":
      rect("#7b708a", center - 1, y - 6, 2, 24);
      rect(state.checkpoint ? "#a3e5b2" : "#c69b82", center, y - 7, 10, 6);
      sparkle(center - 1, y - 8, state.checkpoint ? "#e6ffd1" : "#e0ba9e", 1);
      break;
    case "S":
      halo(state.powerUsed ? "#ffe3a780" : "#b3b0ed5c", center, y + 4, 22);
      rect("#2b2744", x + 1, y + 13, 16, 5);
      rect("#a8a0c0", x + 1, y + 12, 16, 2);
      rect("#615976", center - 3, y + 6, 6, 6);
      sparkle(center, y + 2, state.powerUsed ? "#ffdc90" : "#cfb6ec", 4);
      break;
    case "X": {
      const door = state.powerUsed ? "#dcab7b" : "#2b2539";
      if (state.powerUsed) halo("#f0bc7c85", center, y + 4, 37);
      pixelPath("#55455f", x - 5, y - 16, [[0, 34], [0, 12], [4, 5], [9, 0],
        [19, 0], [24, 5], [28, 12], [28, 34]]);
      pixelPath(door, x - 1, y - 13, [[0, 31], [0, 10], [4, 4], [7, 1],
        [13, 1], [16, 4], [20, 10], [20, 31]]);
      rect(state.powerUsed ? "#ffe5a2" : "#c09677", center - 2, y + 3, 4, 4);
      if (!state.powerUsed) {
        rect("#6d5c76", center - 6, y - 5, 1, 22);
        rect("#6d5c76", center + 5, y - 5, 1, 22);
      } else {
        sparkle(center, y - 4, "#fff1c6", 3);
      }
      break;
    }
  }
}

function drawEnemy(enemy, originY, palette, time) {
  const x = Math.round((enemy.x + enemy.w / 2) * TILE - cameraX);
  const y = Math.round((enemy.y + enemy.h) * TILE + originY);
  const step = Math.round(Math.sin(time / 85 + enemy.x) * 2);
  rect("#201a31", x - 8, y - 2, 16, 2);
  rect("#3e2a52", x - 7, y - 10, 14, 9);
  rect(palette.glow, x - 5, y - 12, 10, 2);
  rect(palette.light, x - 3 + enemy.facing, y - 7, 2, 2);
  rect(palette.light, x + 1 + enemy.facing, y - 7, 2, 2);
  rect("#4d375e", x - 5 + step, y - 2, 3, 2);
  rect("#4d375e", x + 2 - step, y - 2, 3, 2);
}

function drawCat(player, originY, time) {
  const x = Math.round((player.x + player.w / 2) * TILE - cameraX);
  const y = Math.round((player.y + player.h) * TILE + originY);
  const walking = player.grounded && Math.abs(player.vx) > .45;
  const step = walking ? Math.round(Math.sin(time / 62) * 2) : 0;
  const tail = player.grounded ? Math.round(Math.sin(time / 175)) : -2;
  context.save();
  context.translate(x, y);
  context.scale(player.facing, 1);
  pixelPath("#a099b5", -11, -19, [[0, 12], [-3, 9 + tail], [-4, 4 + tail],
    [-2, 3 + tail], [-1, 7 + tail], [3, 11], [8, 11], [9, 5], [9, 0], [11, 0],
    [14, 3], [16, 3], [19, 0], [20, 0], [21, 8], [23, 10], [23, 14],
    [20, 16], [19, 19], [16, 19], [15, 17], [9, 17], [8, 19], [3, 19], [2, 15]]);
  pixelPath("#191724", -11, -19, [[0, 13], [-2, 9 + tail], [-3, 5 + tail],
    [-2, 5 + tail], [-1, 9 + tail], [3, 12], [9, 12], [10, 5], [10, 1],
    [14, 4], [16, 4], [20, 1], [20, 8], [22, 10], [22, 13], [19, 15],
    [18, 18], [16, 18], [16, 16], [8, 16], [7, 18], [4, 18], [3, 14]]);
  rect("#67516e", 0, -16, 2, 3);
  rect("#67516e", 7, -16, 2, 3);
  rect("#3a3248", -7, -7, 9, 3);
  rect("#f6ce7a", 2, -11, 2, 2);
  rect("#f6ce7a", 7, -11, 2, 2);
  rect("#c29bb4", 9, -8, 2, 1);
  rect("#d1a37c", 4, -5, 4, 1);
  rect("#786787", -6 + step, -2, 3, 2);
  rect("#786787", 6 - step, -2, 3, 2);
  context.restore();
}

function draw(time) {
  const level = LEVELS[state.levelIndex];
  const { rows, theme } = level;
  const palette = palettes[theme];
  const originY = VIEW_HEIGHT - rows.length * TILE;
  paintBackground(theme, palette, time);
  const start = Math.max(0, Math.floor(cameraX / TILE) - 2);
  const end = Math.min(rows[0].length, Math.ceil((cameraX + viewWidth) / TILE) + 2);
  for (const [row, line] of rows.entries()) {
    for (let column = start; column < end; column++) {
      const tile = line[column];
      const x = column * TILE - cameraX;
      const y = row * TILE + originY;
      drawTerrain(tile, x, y, column, row, rows, palette);
      drawFeature(tile, x, y, column, row, palette, time);
    }
  }
  for (const enemy of state.enemies) {
    if (enemy.alive) drawEnemy(enemy, originY, palette, time);
  }
  drawCat(state.player, originY, time);
}

function targetCamera() {
  const levelWidth = LEVELS[state.levelIndex].rows[0].length * TILE;
  const playerCenter = (state.player.x + state.player.w / 2) * TILE;
  return Math.max(0, Math.min(levelWidth - viewWidth, playerCenter - viewWidth * .34));
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  if (!clientWidth || !clientHeight) return;
  viewWidth = VIEW_HEIGHT * clientWidth / clientHeight;
  canvas.width = Math.round(viewWidth * 2);
  context.setTransform(canvas.width / viewWidth, 0, 0, canvas.height / VIEW_HEIGHT, 0, 0);
  context.imageSmoothingEnabled = false;
  cameraX = targetCamera();
  draw(0);
}

function showText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function updateHUD() {
  const { levelIndex, phase, cardFound, powerUsed, message } = state;
  const level = LEVELS[levelIndex];
  const card = CARDS[level.cardId];
  if (shownLevel !== levelIndex) {
    shownLevel = levelIndex;
    stageNumber.textContent = `Fase ${levelIndex + 1} / ${LEVELS.length}`;
    stageTitle.textContent = level.name;
    canvas.setAttribute("aria-label", `Neblina em ${level.name}`);
    cardArt.src = `./assets/taro/${level.cardId}.webp`;
    cardName.textContent = card.name;
    cardPower.textContent = card.power;
  }

  showText(objective, getObjective(state));
  showText(feedback, message || "");
  const sparks = `✦ ${state.collected.length}/${sparksPerLevel[levelIndex]}`;
  if (sparkCount.textContent !== sparks) {
    sparkCount.textContent = sparks;
    sparkCount.setAttribute("aria-label", `${state.collected.length} de ${sparksPerLevel[levelIndex]} brilhos coletados`);
  }
  const ready = cardFound && !powerUsed && phase === "playing";
  cardButton.dataset.state = powerUsed ? "used" : ready ? "ready" : "locked";
  cardButton.disabled = !ready;
  showText(cardStatus, powerUsed ? "Usada" : ready ? "Usar · E" : "A encontrar");

  if (scene.dataset.phase === phase) return;
  scene.dataset.phase = phase;
  victory.hidden = phase === "playing";
  if (phase === "playing") return;

  const won = phase === "won";
  victoryTitle.textContent = won ? "Neblina encontrou a saída!" : "Fase concluída!";
  victoryDetail.textContent = won
    ? "Os três arcanos guiaram Neblina pela noite."
    : `A seguir: ${LEVELS[levelIndex + 1].name}.`;
  nextAction.textContent = won ? "Jogar de novo" : "Próxima fase";
  clearInput();
  nextAction.focus({ preventScroll: true });
}

function queueAction(action) {
  if (action === "left" || action === "right") {
    movementPulse[action] = 3;
  } else {
    queued.add(action);
  }
}

function clearInput() {
  keyboard.clear();
  pointers.clear();
  queued.clear();
  movementPulse.left = 0;
  movementPulse.right = 0;
  for (const button of touches) button.classList.remove("is-held");
}

function stepInput() {
  const held = new Set([...keyboard.values(), ...pointers.values()]);
  const jump = queued.delete("jump");
  const use = queued.delete("use");
  const left = held.has("left") || movementPulse.left > 0;
  const right = held.has("right") || movementPulse.right > 0;
  movementPulse.left = Math.max(0, movementPulse.left - 1);
  movementPulse.right = Math.max(0, movementPulse.right - 1);
  return { left, right, jump, jumpHeld: jump || held.has("jump"), use };
}

function animate(now) {
  const elapsed = lastFrame === undefined ? 0 : Math.min((now - lastFrame) / 1000, .05);
  lastFrame = now;
  accumulator += elapsed;
  let snapped = reducedMotion.matches;
  while (accumulator >= STEP) {
    const playerX = state.player.x;
    state = tick(state, stepInput(), STEP);
    if (Math.abs(playerX - state.player.x) > 4) snapped = true;
    accumulator -= STEP;
  }
  const target = targetCamera();
  cameraX = snapped ? target : cameraX + (target - cameraX) * Math.min(1, elapsed * 9);
  draw(reducedMotion.matches ? 0 : now);
  updateHUD();
  requestAnimationFrame(animate);
}

function begin(nextState) {
  clearInput();
  state = nextState;
  accumulator = 0;
  cameraX = targetCamera();
  updateHUD();
  draw(0);
  canvas.focus({ preventScroll: true });
}

function completeAction() {
  if (state.phase === "won") begin(createGame());
  else if (state.phase === "level-complete") begin(advanceLevel(state));
}

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (state.phase !== "playing") {
    if (key === "enter" && !event.repeat) {
      event.preventDefault();
      completeAction();
    }
    return;
  }

  const action = keyActions[key];
  if (!action || (key === " " && event.target instanceof HTMLButtonElement)) return;
  event.preventDefault();
  if (event.repeat || keyboard.has(key)) return;
  keyboard.set(key, action);
  queueAction(action);
});

window.addEventListener("keyup", (event) => keyboard.delete(event.key.toLowerCase()));
window.addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInput();
    lastFrame = undefined;
    accumulator = 0;
  }
});

canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));
document.getElementById("reset-game").addEventListener("click", () => begin(restartLevel(state)));
nextAction.addEventListener("click", completeAction);
cardButton.addEventListener("click", () => {
  if (state.phase === "playing") queueAction("use");
  canvas.focus({ preventScroll: true });
});

for (const button of touches) {
  const { action } = button.dataset;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.phase !== "playing") return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    button.classList.add("is-held");
    pointers.set(event.pointerId, action);
    queueAction(action);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(eventName, (event) => {
      pointers.delete(event.pointerId);
      if (![...pointers.values()].includes(action)) button.classList.remove("is-held");
    });
  }
  button.addEventListener("click", (event) => {
    if (event.detail === 0 && state.phase === "playing") queueAction(action);
  });
}

new ResizeObserver(resize).observe(canvas);
resize();
updateHUD();
requestAnimationFrame(animate);

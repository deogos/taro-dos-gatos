import { LEVELS } from "./levels.js";

export { LEVELS };

export const CARDS = {
  lua: { name: "A Lua", power: "Revela as plataformas escondidas." },
  forca: { name: "A Força", power: "Quebra as pedras frágeis." },
  estrela: { name: "A Estrela", power: "Acende o altar e abre a saída." },
};

const CARD_TASKS = {
  lua: {
    target: "M",
    find: "Encontre A Lua no jardim.",
    use: "Use A Lua perto das plataformas ocultas.",
    success: "O luar revelou as plataformas!",
  },
  forca: {
    target: "B",
    find: "Encontre A Força na cripta.",
    use: "Use A Força perto das pedras frágeis.",
    success: "A Força partiu as pedras!",
  },
  estrela: {
    target: "S",
    find: "Encontre A Estrela no observatório.",
    use: "Use A Estrela perto do altar.",
    success: "O altar acendeu as plataformas e abriu a saída!",
  },
};

const PLAYER_WIDTH = 0.72;
const PLAYER_HEIGHT = 0.8;
const ENEMY_WIDTH = 0.72;
const ENEMY_HEIGHT = 0.62;
const RUN_SPEED = 6.5;
const JUMP_SPEED = 10.4;
const GRAVITY = 24;
const ENEMY_SPEED = 1.5;
const PATROL_RADIUS = 2.75;
const COYOTE_TIME = 0.095;
const JUMP_BUFFER = 0.12;
const POWER_REACH = 3;
const EPSILON = 0.00001;
const MAX_STEP = 1 / 120;

const mapDetails = LEVELS.map(({ rows }) => {
  const points = {};
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      if (".#=".includes(tile)) continue;
      (points[tile] ??= []).push({ x, y });
    }
  });
  return { rows, points, width: rows[0].length, height: rows.length };
});

function atTile(tile, w, h) {
  return { x: tile.x + (1 - w) / 2, y: tile.y + 1 - h, w, h };
}

function solidAt(map, powerUsed, x, y) {
  if (x < 0 || x >= map.width || y < 0) return true;
  const tile = map.rows[y]?.[x];
  return tile === "#" || tile === "=" || (powerUsed ? tile === "M" : tile === "B");
}

function onFloor(actor, map, powerUsed) {
  const floor = Math.floor(actor.y + actor.h + EPSILON);
  const left = Math.floor(actor.x + EPSILON);
  const right = Math.floor(actor.x + actor.w - EPSILON);
  return solidAt(map, powerUsed, left, floor) || solidAt(map, powerUsed, right, floor);
}

function startPlayer(tile, map, powerUsed) {
  const player = {
    ...atTile(tile, PLAYER_WIDTH, PLAYER_HEIGHT),
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
  };
  player.grounded = onFloor(player, map, powerUsed);
  return player;
}

export function createGame(levelIndex = 0) {
  const map = mapDetails[levelIndex];
  return {
    levelIndex,
    player: startPlayer(map.points.P[0], map, false),
    cardFound: false,
    powerUsed: false,
    checkpoint: null,
    collected: [],
    enemies: (map.points.E ?? []).map((tile) => {
      const enemy = atTile(tile, ENEMY_WIDTH, ENEMY_HEIGHT);
      return { ...enemy, originX: enemy.x, alive: true, facing: -1 };
    }),
    phase: "playing",
    message: "",
    coyote: 0,
    jumpBuffer: 0,
    respawnSafety: 0,
  };
}

export function restartLevel(state) {
  return createGame(state.levelIndex);
}

export function advanceLevel(state) {
  return state.phase === "level-complete" ? createGame(state.levelIndex + 1) : state;
}

export function getObjective(state) {
  if (state.phase === "won") return "Neblina encontrou a saída do observatório.";
  if (state.phase === "level-complete") return "Fase concluída.";
  if (state.powerUsed) return "Siga até a saída da fase.";

  const task = CARD_TASKS[LEVELS[state.levelIndex].cardId];
  return state.cardFound ? task.use : task.find;
}

function overlaps(first, second) {
  return first.x < second.x + second.w
    && first.x + first.w > second.x
    && first.y < second.y + second.h
    && first.y + first.h > second.y;
}

function touches(player, tiles = []) {
  return tiles.some(({ x, y }) => overlaps(player, { x, y, w: 1, h: 1 }));
}

function moveHorizontally(actor, map, powerUsed, offset) {
  if (offset === 0) return;
  actor.x += offset;
  const movingRight = offset > 0;
  const edge = Math.floor(movingRight ? actor.x + actor.w - EPSILON : actor.x + EPSILON);
  const top = Math.floor(actor.y + EPSILON);
  const bottom = Math.floor(actor.y + actor.h - EPSILON);
  for (let y = top; y <= bottom; y++) {
    if (!solidAt(map, powerUsed, edge, y)) continue;
    actor.x = movingRight ? edge - actor.w : edge + 1;
    actor.vx = 0;
    return;
  }
}

function moveVertically(actor, map, powerUsed, offset) {
  actor.grounded = false;
  if (offset === 0) return;
  actor.y += offset;
  const falling = offset > 0;
  const edge = Math.floor(falling ? actor.y + actor.h - EPSILON : actor.y + EPSILON);
  const left = Math.floor(actor.x + EPSILON);
  const right = Math.floor(actor.x + actor.w - EPSILON);
  for (let x = left; x <= right; x++) {
    if (!solidAt(map, powerUsed, x, edge)) continue;
    actor.y = falling ? edge - actor.h : edge + 1;
    actor.vy = 0;
    actor.grounded = falling;
    return;
  }
}

function moveEnemies(state, map, dt) {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    const candidate = enemy.x + enemy.facing * ENEMY_SPEED * dt;
    const front = enemy.facing > 0 ? candidate + enemy.w : candidate;
    const column = Math.floor(front + enemy.facing * 0.04);
    const floor = Math.floor(enemy.y + enemy.h + EPSILON);
    if (Math.abs(candidate - enemy.originX) > PATROL_RADIUS
      || solidAt(map, state.powerUsed, column, floor - 1)
      || !solidAt(map, state.powerUsed, column, floor)) {
      enemy.facing *= -1;
    } else {
      enemy.x = candidate;
    }
  }
}

function respawn(state, map) {
  state.player = startPlayer(state.checkpoint ?? map.points.P[0], map, state.powerUsed);
  state.jumpBuffer = 0;
  state.coyote = 0;
  state.respawnSafety = 0.7;
  state.message = state.checkpoint
    ? "Neblina voltou ao ponto de controle."
    : "Neblina voltou ao início da fase.";
}

function hitHazard(state, map, lastFeet, falling) {
  const { player } = state;
  const onSpikes = (map.points["^"] ?? []).some(({ x, y }) =>
    overlaps(player, { x: x + 0.13, y: y + 0.28, w: 0.74, h: 0.72 }));
  if (player.y > map.height + 0.35 || onSpikes) return true;

  for (const enemy of state.enemies) {
    if (!enemy.alive || !overlaps(player, enemy)) continue;
    if (falling && lastFeet <= enemy.y + 0.1) {
      enemy.alive = false;
      player.y = enemy.y - player.h;
      player.vy = -6.6;
      player.grounded = false;
      continue;
    }
    if (state.respawnSafety <= 0) return true;
  }
  return false;
}

function collectItems(state, map) {
  const { player } = state;
  if (!state.cardFound && touches(player, map.points.C)) {
    const card = CARDS[LEVELS[state.levelIndex].cardId];
    state.cardFound = true;
    state.message = "Neblina encontrou " + card.name + "!";
  }

  for (const { x, y } of map.points["*"] ?? []) {
    const key = x + "," + y;
    if (!state.collected.includes(key) && overlaps(player, { x, y, w: 1, h: 1 })) {
      state.collected.push(key);
    }
  }

  for (const checkpoint of map.points.K ?? []) {
    if (state.checkpoint === checkpoint || !touches(player, [checkpoint])) continue;
    state.checkpoint = checkpoint;
    state.message = "Ponto de controle ativado.";
  }
}

function activatePower(state, map) {
  if (state.powerUsed) return;
  if (!state.cardFound) {
    state.message = "Encontre a carta desta fase.";
    return;
  }

  const { player } = state;
  const task = CARD_TASKS[LEVELS[state.levelIndex].cardId];
  const nearby = (map.points[task.target] ?? []).some(({ x, y }) =>
    Math.hypot(player.x + player.w / 2 - x - 0.5, player.y + player.h / 2 - y - 0.5) <= POWER_REACH);
  if (!nearby) {
    state.message = task.use;
    return;
  }
  if (touches(player, map.points.M)) {
    state.message = "Dê espaço para as plataformas aparecerem e tente de novo.";
    return;
  }

  state.powerUsed = true;
  state.message = task.success;
}

function finishLevel(state, map) {
  if (!touches(state.player, map.points.X)) return;
  if (!state.powerUsed) {
    state.message = "Use a carta da fase para abrir a saída.";
    return;
  }

  const isLast = state.levelIndex === LEVELS.length - 1;
  state.phase = isLast ? "won" : "level-complete";
  state.message = isLast ? "Neblina saiu do observatório!" : "Neblina encontrou a saída!";
}

function step(state, map, direction, jumpHeld, use, dt) {
  const { player } = state;
  state.respawnSafety = Math.max(0, state.respawnSafety - dt);
  state.coyote = player.grounded ? COYOTE_TIME : Math.max(0, state.coyote - dt);
  state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);
  if (state.jumpBuffer > 0 && state.coyote > 0) {
    player.vy = -JUMP_SPEED;
    player.grounded = false;
    state.coyote = 0;
    state.jumpBuffer = 0;
  }

  if (!jumpHeld && player.vy < -4) player.vy = -4;
  if (direction) player.facing = direction;
  player.vx = direction * RUN_SPEED;
  player.vy = Math.min(player.vy + GRAVITY * dt, 17);

  const lastFeet = player.y + player.h;
  const falling = player.vy > 0;
  moveHorizontally(player, map, state.powerUsed, player.vx * dt);
  moveVertically(player, map, state.powerUsed, player.vy * dt);
  moveEnemies(state, map, dt);

  if (hitHazard(state, map, lastFeet, falling)) {
    respawn(state, map);
    return false;
  }

  collectItems(state, map);
  if (use) activatePower(state, map);
  finishLevel(state, map);
  return state.phase === "playing";
}

export function tick(state, input, dtSeconds) {
  if (state.phase !== "playing" || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return state;

  const { left, right, jump, jumpHeld = true, use } = input;
  const direction = Number(Boolean(right)) - Number(Boolean(left));
  const map = mapDetails[state.levelIndex];
  const duration = Math.min(dtSeconds, 0.1);
  const steps = Math.ceil(duration / MAX_STEP);
  if (jump) state.jumpBuffer = JUMP_BUFFER;

  for (let frame = 0; frame < steps; frame++) {
    if (!step(state, map, direction, jumpHeld || jump, frame === 0 && use, duration / steps)) break;
  }
  return state;
}

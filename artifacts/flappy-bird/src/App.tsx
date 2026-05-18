import { useEffect, useRef, useState, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const CANVAS_W = 360;
const CANVAS_H = 560;
const BIRD_X = 75;
const BIRD_R = 16;
const GRAVITY = 0.42;
const BASE_FLAP = -8.5;
const BASE_PIPE_SPEED = 2.4;
const BASE_PIPE_GAP = 150;
const BASE_PIPE_INTERVAL = 90;
const CIGS_SPAWN_INTERVAL = 200;
const BUZZ_BASE_DURATION = 300;
const BUZZ_COIN_MULT = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Upgrades {
  wingPower: number;
  tailWind: number;
  wideGap: number;
  coinBoost: number;
  shield: number;
  slowTime: number;
  chainSmoker: number;
}

const MAX_LEVELS: Upgrades = {
  wingPower: 10,
  tailWind: 8,
  wideGap: 8,
  coinBoost: 10,
  shield: 3,
  slowTime: 5,
  chainSmoker: 8,
};

const BASE_COSTS: Record<keyof Upgrades, number> = {
  wingPower: 12,
  tailWind: 20,
  wideGap: 25,
  coinBoost: 15,
  shield: 80,
  slowTime: 40,
  chainSmoker: 18,
};

function upgradeCost(key: keyof Upgrades, level: number): number {
  return Math.floor(BASE_COSTS[key] * Math.pow(1.8, level));
}

interface Bird { y: number; vy: number; angle: number; }
interface Pipe { x: number; topH: number; scored: boolean; }
interface Cigarette { id: number; x: number; y: number; collected: boolean; }
interface SmokeParticle { x: number; y: number; dx: number; dy: number; alpha: number; size: number; }

interface GameState {
  bird: Bird;
  pipes: Pipe[];
  cigarettes: Cigarette[];
  smokeParticles: SmokeParticle[];
  score: number;
  runCoins: number;
  frame: number;
  phase: "idle" | "playing" | "dead";
  shieldActive: boolean;
  shieldUsed: boolean;
  slowActive: boolean;
  slowTimer: number;
  buzzed: boolean;
  buzzTimer: number;
  cigIdCounter: number;
}

interface SaveData {
  coins: number;
  upgrades: Upgrades;
  bestScore: number;
  totalRuns: number;
  lifetimeCoins: number;
  cigarettesSmoked: number;
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem("flappy-incremental");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        cigarettesSmoked: 0,
        ...parsed,
        upgrades: {
          wingPower: 0, tailWind: 0, wideGap: 0, coinBoost: 0,
          shield: 0, slowTime: 0, chainSmoker: 0,
          ...parsed.upgrades,
        },
      };
    }
  } catch (_) {}
  return {
    coins: 0,
    upgrades: { wingPower: 0, tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0 },
    bestScore: 0, totalRuns: 0, lifetimeCoins: 0, cigarettesSmoked: 0,
  };
}

function saveSave(data: SaveData) {
  localStorage.setItem("flappy-incremental", JSON.stringify(data));
}

// ─── Derived stats ────────────────────────────────────────────────────────────

function getStats(u: Upgrades) {
  return {
    flapPower: BASE_FLAP - u.wingPower * 0.55,
    pipeSpeed: Math.max(1.0, BASE_PIPE_SPEED - u.tailWind * 0.18),
    pipeGap: BASE_PIPE_GAP + u.wideGap * 18,
    coinsPerPipe: 1 + u.coinBoost,
    hasShield: u.shield > 0,
    slowDuration: u.slowTime * 120,
    pipeInterval: Math.max(55, BASE_PIPE_INTERVAL - u.tailWind * 2),
    buzzDuration: BUZZ_BASE_DURATION + u.chainSmoker * 80,
    cigCoinBonus: 8 + u.chainSmoker * 4,
  };
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCigarette(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.22 + Math.sin(frame * 0.04) * 0.06);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(1, 2, 16, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // White paper body
  const bodyGrad = ctx.createLinearGradient(0, -3, 0, 3);
  bodyGrad.addColorStop(0, "#f8f8f8");
  bodyGrad.addColorStop(1, "#d8d8d8");
  ctx.fillStyle = bodyGrad;
  rr(ctx, -14, -3, 22, 6, 2);
  ctx.fill();

  // Filter tip (orange-brown)
  const tipGrad = ctx.createLinearGradient(0, -3, 0, 3);
  tipGrad.addColorStop(0, "#D2691E");
  tipGrad.addColorStop(1, "#A0522D");
  ctx.fillStyle = tipGrad;
  rr(ctx, 8, -3, 8, 6, 2);
  ctx.fill();

  // Filter line detail
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(8, -3);
  ctx.lineTo(8, 3);
  ctx.stroke();

  // Burning tip glow
  ctx.fillStyle = "#ff6b1a";
  ctx.beginPath();
  ctx.arc(-14, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.arc(-14, 0, 2, 0, Math.PI * 2);
  ctx.fill();

  // Glow halo around lit end
  const glow = ctx.createRadialGradient(-14, 0, 1, -14, 0, 9);
  glow.addColorStop(0, "rgba(255,120,0,0.4)");
  glow.addColorStop(1, "rgba(255,120,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(-14, 0, 9, 0, Math.PI * 2);
  ctx.fill();

  // Smoke wisps from lit end
  for (let i = 0; i < 3; i++) {
    const t = (frame * 0.05 + i * 0.9) % 1;
    const sx = -14 - t * 10;
    const sy = -t * 14 + Math.sin(t * 8 + i) * 4;
    ctx.globalAlpha = (1 - t) * 0.35;
    ctx.fillStyle = "#cccccc";
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5 + t * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─── Main draw ────────────────────────────────────────────────────────────────

function drawScene(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  bgOff: number,
  upgrades: Upgrades,
  saveData: SaveData
) {
  const { bird, pipes, cigarettes = [], smokeParticles = [], score, phase, runCoins, shieldActive, buzzed = false, buzzTimer = 0 } = state;
  const stats = getStats(upgrades);
  const isSlowed = state.slowActive;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H - 36);
  if (buzzed) {
    sky.addColorStop(0, "#1a1200");
    sky.addColorStop(0.6, "#2a1e04");
    sky.addColorStop(1, "#1a1000");
  } else if (isSlowed) {
    sky.addColorStop(0, "#1a0a2e");
    sky.addColorStop(1, "#3a0a6e");
  } else {
    sky.addColorStop(0, "#0d1b2a");
    sky.addColorStop(0.6, "#1b3a5c");
    sky.addColorStop(1, "#0f3460");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H - 36);

  // Stars / motes
  ctx.fillStyle = buzzed ? "rgba(255,210,80,0.6)" : isSlowed ? "rgba(200,150,255,0.7)" : "rgba(255,255,255,0.55)";
  [[28,38],[75,18],[130,55],[195,12],[250,42],[315,28],[355,65],[45,85],[105,108],[165,78],[225,98],[295,82],[345,118],[18,138],[88,148],[158,128],[238,158],[308,142]].forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.arc(((sx - bgOff * 0.08) % CANVAS_W + CANVAS_W) % CANVAS_W, sy, 1.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Clouds
  ctx.fillStyle = buzzed ? "rgba(255,200,50,0.08)" : isSlowed ? "rgba(180,100,255,0.1)" : "rgba(255,255,255,0.06)";
  [[60, 170, 85, 28], [220, 210, 65, 22], [330, 190, 75, 26]].forEach(([cx, cy, cw, ch]) => {
    const x = ((cx - bgOff * 0.28) % CANVAS_W + CANVAS_W) % CANVAS_W;
    ctx.beginPath();
    ctx.ellipse(x, cy, cw, ch, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Buzz vignette
  if (buzzed) {
    const vig = ctx.createRadialGradient(CANVAS_W/2, CANVAS_H/2, 80, CANVAS_W/2, CANVAS_H/2, 290);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(180,120,0,0.3)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Slow vignette
  if (isSlowed) {
    const vig = ctx.createRadialGradient(CANVAS_W/2, CANVAS_H/2, 80, CANVAS_W/2, CANVAS_H/2, 280);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(100,0,200,0.25)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  const PW = 58;
  const pipeGap = stats.pipeGap;

  // Pipes
  pipes.forEach((pipe) => {
    const botY = pipe.topH + pipeGap;
    const botH = CANVAS_H - 36 - botY;
    const pg = ctx.createLinearGradient(pipe.x, 0, pipe.x + PW, 0);
    pg.addColorStop(0, "#27ae60"); pg.addColorStop(0.35, "#2ecc71"); pg.addColorStop(1, "#1e8449");
    ctx.fillStyle = pg;
    rr(ctx, pipe.x, 0, PW, pipe.topH - 10, 4); ctx.fill();
    rr(ctx, pipe.x, botY + 10, PW, botH, 4); ctx.fill();
    const capG = ctx.createLinearGradient(pipe.x - 4, 0, pipe.x + PW + 4, 0);
    capG.addColorStop(0, "#27ae60"); capG.addColorStop(0.4, "#2ecc71"); capG.addColorStop(1, "#1e8449");
    ctx.fillStyle = capG;
    rr(ctx, pipe.x - 4, pipe.topH - 22, PW + 8, 22, 5); ctx.fill();
    rr(ctx, pipe.x - 4, botY, PW + 8, 22, 5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(pipe.x + 7, 0, 8, pipe.topH - 10);
    ctx.fillRect(pipe.x + 7, botY + 10, 8, botH);
  });

  // Cigarettes in the world
  cigarettes.forEach((cig) => {
    if (!cig.collected) drawCigarette(ctx, cig.x, cig.y, state.frame);
  });

  // Ground
  const grd = ctx.createLinearGradient(0, CANVAS_H - 36, 0, CANVAS_H);
  grd.addColorStop(0, "#8b6914"); grd.addColorStop(0.3, "#a0791c"); grd.addColorStop(1, "#6b4f10");
  ctx.fillStyle = grd;
  ctx.fillRect(0, CANVAS_H - 36, CANVAS_W, 36);
  ctx.fillStyle = "#2ecc71";
  ctx.fillRect(0, CANVAS_H - 36, CANVAS_W, 7);
  for (let i = 0; i < 9; i++) {
    const lx = ((i * 48) - (bgOff * 2) % 48 + 48) % CANVAS_W;
    ctx.strokeStyle = "rgba(0,0,0,0.13)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, CANVAS_H - 28); ctx.lineTo(lx + 26, CANVAS_H); ctx.stroke();
  }

  // Smoke particles (from bird when buzzed)
  smokeParticles.forEach((p) => {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = "#c8c8c8";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Bird
  ctx.save();
  ctx.translate(BIRD_X, bird.y);
  ctx.rotate(bird.angle);

  // Shield aura
  if (shieldActive) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(state.frame * 0.15) * 0.15;
    const aura = ctx.createRadialGradient(0, 0, BIRD_R, 0, 0, BIRD_R + 12);
    aura.addColorStop(0, "#00d2ff"); aura.addColorStop(1, "rgba(0,210,255,0)");
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(0, 0, BIRD_R + 12, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Buzz aura (yellow/orange glow)
  if (buzzed) {
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.sin(state.frame * 0.2) * 0.12;
    const ba = ctx.createRadialGradient(0, 0, BIRD_R, 0, 0, BIRD_R + 14);
    ba.addColorStop(0, "#ffcc00"); ba.addColorStop(1, "rgba(255,180,0,0)");
    ctx.fillStyle = ba;
    ctx.beginPath(); ctx.arc(0, 0, BIRD_R + 14, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Bird shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(3, 3, BIRD_R, BIRD_R - 2, 0, 0, Math.PI * 2); ctx.fill();

  // Body
  const bg = ctx.createRadialGradient(-4, -4, 2, 0, 0, BIRD_R);
  bg.addColorStop(0, "#FFE066"); bg.addColorStop(0.6, "#F1C40F"); bg.addColorStop(1, "#D4AC0D");
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(0, 0, BIRD_R, BIRD_R - 2, 0, 0, Math.PI * 2); ctx.fill();

  // Wing
  const wa = Math.sin(state.frame * 0.28) * 0.38;
  ctx.save(); ctx.rotate(wa);
  ctx.fillStyle = "#E67E22";
  ctx.beginPath(); ctx.ellipse(-4, 4, 9, 4.5, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Eye
  ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(7, -5, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2c3e50"; ctx.beginPath(); ctx.arc(8, -5, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(9, -6, 1.1, 0, Math.PI * 2); ctx.fill();

  // Beak - with tiny cigarette dangling if buzzed
  ctx.fillStyle = "#E67E22";
  ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(20, 0); ctx.lineTo(12, 3.5); ctx.closePath(); ctx.fill();

  if (buzzed) {
    // Tiny dangling cigarette from beak
    ctx.save();
    ctx.translate(20, 1);
    ctx.rotate(0.25);
    ctx.fillStyle = "#e8e8e8";
    rr(ctx, 0, -1.5, 10, 3, 1); ctx.fill();
    ctx.fillStyle = "#A0522D";
    rr(ctx, 7, -1.5, 4, 3, 1); ctx.fill();
    ctx.fillStyle = "#ff4500";
    ctx.beginPath(); ctx.arc(10, 0, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  // HUD
  if (phase === "playing" || phase === "dead") {
    ctx.fillStyle = "white";
    ctx.font = "bold 36px Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 6;
    ctx.fillText(String(score), CANVAS_W / 2, 55);
    ctx.shadowBlur = 0;

    ctx.font = "bold 15px Arial";
    ctx.fillStyle = "#F1C40F";
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4;
    ctx.fillText(`🪙 +${runCoins}`, 10, 55);
    ctx.shadowBlur = 0;

    // Buzz bar
    if (buzzed) {
      const frac = buzzTimer / stats.buzzDuration;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      rr(ctx, CANVAS_W - 105, 10, 95, 13, 6); ctx.fill();
      const buzzBarGrad = ctx.createLinearGradient(CANVAS_W - 105, 0, CANVAS_W - 10, 0);
      buzzBarGrad.addColorStop(0, "#f59e0b");
      buzzBarGrad.addColorStop(1, "#ef4444");
      ctx.fillStyle = buzzBarGrad;
      rr(ctx, CANVAS_W - 105, 10, 95 * frac, 13, 6); ctx.fill();
      ctx.fillStyle = "white"; ctx.font = "bold 10px Arial"; ctx.textAlign = "center";
      ctx.fillText("🚬 BUZZED! x" + BUZZ_COIN_MULT, CANVAS_W - 57, 21);
    }

    // Slow bar
    if (state.slowActive) {
      const frac = state.slowTimer / stats.slowDuration;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      rr(ctx, CANVAS_W - 105, buzzed ? 28 : 10, 95, 12, 6); ctx.fill();
      ctx.fillStyle = "#a855f7";
      rr(ctx, CANVAS_W - 105, buzzed ? 28 : 10, 95 * frac, 12, 6); ctx.fill();
      ctx.fillStyle = "white"; ctx.font = "10px Arial"; ctx.textAlign = "center";
      ctx.fillText("SLOW TIME", CANVAS_W - 57, buzzed ? 38 : 20);
    }
  }

  // Idle screen
  if (phase === "idle") {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    rr(ctx, 30, CANVAS_H / 2 - 100, CANVAS_W - 60, 200, 18); ctx.fill();
    ctx.fillStyle = "#F1C40F"; ctx.font = "bold 38px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 8;
    ctx.fillText("FLAPPY INC.", CANVAS_W / 2, CANVAS_H / 2 - 42);
    ctx.fillStyle = "white"; ctx.font = "16px Arial"; ctx.shadowBlur = 3;
    ctx.fillText("Click / Space to flap", CANVAS_W / 2, CANVAS_H / 2 + 4);
    ctx.fillText("Collect 🚬 for a coin buzz!", CANVAS_W / 2, CANVAS_H / 2 + 28);
    if (saveData.bestScore > 0) {
      ctx.fillStyle = "#a3e635"; ctx.font = "14px Arial";
      ctx.fillText(`Best: ${saveData.bestScore}  •  Smoked: ${saveData.cigarettesSmoked}`, CANVAS_W / 2, CANVAS_H / 2 + 62);
    }
    ctx.shadowBlur = 0;
  }

  // Dead screen
  if (phase === "dead") {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    rr(ctx, 30, CANVAS_H / 2 - 115, CANVAS_W - 60, 225, 18); ctx.fill();
    ctx.fillStyle = "#ef4444"; ctx.font = "bold 34px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 8;
    ctx.fillText("CRASH!", CANVAS_W / 2, CANVAS_H / 2 - 60);
    ctx.fillStyle = "white"; ctx.font = "20px Arial";
    ctx.fillText(`Score: ${score}`, CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.fillStyle = "#F1C40F"; ctx.font = "17px Arial";
    ctx.fillText(`+${runCoins} coins earned`, CANVAS_W / 2, CANVAS_H / 2 + 12);
    ctx.fillStyle = "#a3e635"; ctx.font = "14px Arial";
    ctx.fillText(`Best: ${saveData.bestScore}  •  Smoked: ${saveData.cigarettesSmoked}`, CANVAS_W / 2, CANVAS_H / 2 + 40);
    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.font = "15px Arial";
    ctx.fillText("Click or Space to try again", CANVAS_W / 2, CANVAS_H / 2 + 76);
    ctx.shadowBlur = 0;
  }
}

// ─── Upgrade Config ───────────────────────────────────────────────────────────

const UPGRADE_DEFS: { key: keyof Upgrades; name: string; desc: (lvl: number) => string; icon: string }[] = [
  { key: "wingPower",    icon: "🪽",  name: "Wing Power",    desc: (l) => `Flap strength +${(l * 0.55).toFixed(1)} → stronger jumps` },
  { key: "tailWind",     icon: "💨",  name: "Tail Wind",     desc: (l) => `Pipe speed -${(l * 0.18).toFixed(2)} → more time to react` },
  { key: "wideGap",      icon: "📐",  name: "Wide Gap",      desc: (l) => `Gap +${l * 18}px → easier to pass` },
  { key: "coinBoost",    icon: "🪙",  name: "Coin Boost",    desc: (l) => `${1 + l} coin${1 + l > 1 ? "s" : ""} per pipe → earn faster` },
  { key: "shield",       icon: "🛡️",  name: "Shield",        desc: (l) => l === 0 ? "No shield yet" : `Survive ${l} crash${l > 1 ? "es" : ""} per run` },
  { key: "slowTime",     icon: "⏱️",  name: "Slow Time",     desc: (l) => l === 0 ? "Unlock slow-time power" : `Slow lasts ${l * 2}s per run` },
  { key: "chainSmoker",  icon: "🚬",  name: "Chain Smoker",  desc: (l) => l === 0 ? "More cigarettes + bigger buzz bonus" : `Buzz lasts ${(BUZZ_BASE_DURATION / 60 + l * 80 / 60).toFixed(1)}s, +${8 + l * 4} coins per cig` },
];

// ─── Main Component ───────────────────────────────────────────────────────────

function makeInitialGame(): GameState {
  return {
    bird: { y: CANVAS_H / 2, vy: 0, angle: 0 },
    pipes: [], cigarettes: [], smokeParticles: [],
    score: 0, runCoins: 0, frame: 0,
    phase: "idle",
    shieldActive: false, shieldUsed: false,
    slowActive: false, slowTimer: 0,
    buzzed: false, buzzTimer: 0,
    cigIdCounter: 0,
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameState>(makeInitialGame());
  const bgOffRef = useRef(0);
  const rafRef = useRef(0);
  const [saveData, setSaveData] = useState<SaveData>(loadSave);
  const saveDataRef = useRef<SaveData>(saveData);
  saveDataRef.current = saveData;
  const [, tick] = useState(0);

  const persistSave = useCallback((data: SaveData) => {
    saveSave(data);
    setSaveData({ ...data });
  }, []);

  const buyUpgrade = useCallback((key: keyof Upgrades) => {
    const sd = saveDataRef.current;
    const lvl = sd.upgrades[key];
    if (lvl >= MAX_LEVELS[key]) return;
    const cost = upgradeCost(key, lvl);
    if (sd.coins < cost) return;
    persistSave({ ...sd, coins: sd.coins - cost, upgrades: { ...sd.upgrades, [key]: lvl + 1 } });
  }, [persistSave]);

  const flap = useCallback(() => {
    const gs = gameRef.current;
    const sd = saveDataRef.current;
    const stats = getStats(sd.upgrades);
    if (gs.phase === "idle") {
      gameRef.current = { ...gs, phase: "playing", bird: { ...gs.bird, vy: stats.flapPower }, shieldActive: sd.upgrades.shield > 0, shieldUsed: false, slowActive: false, slowTimer: stats.slowDuration };
    } else if (gs.phase === "playing") {
      gameRef.current = { ...gs, bird: { ...gs.bird, vy: stats.flapPower } };
    } else if (gs.phase === "dead") {
      gameRef.current = makeInitialGame();
    }
  }, []);

  const activateSlow = useCallback(() => {
    const gs = gameRef.current;
    const sd = saveDataRef.current;
    const stats = getStats(sd.upgrades);
    if (gs.phase !== "playing" || gs.slowActive || stats.slowDuration === 0) return;
    gameRef.current = { ...gs, slowActive: true, slowTimer: stats.slowDuration };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " " || e.key === "ArrowUp") { e.preventDefault(); flap(); }
      if (e.key === "s" || e.key === "S") activateSlow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flap, activateSlow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function loop() {
      const gs = gameRef.current;
      const sd = saveDataRef.current;
      const stats = getStats(sd.upgrades);
      const PW = 58;

      if (gs.phase === "playing") {
        const speedMult = gs.slowActive ? 0.3 : 1.0;
        bgOffRef.current += stats.pipeSpeed * speedMult;

        const newVy = gs.bird.vy + GRAVITY * speedMult;
        const newY = gs.bird.y + newVy * speedMult;
        const newAngle = Math.max(-0.5, Math.min(Math.PI / 2.3, newVy * 0.07));
        const newBird: Bird = { y: newY, vy: newVy, angle: newAngle };
        const newFrame = gs.frame + 1;

        // Pipes
        let newPipes = gs.pipes.map((p) => ({ ...p, x: p.x - stats.pipeSpeed * speedMult })).filter((p) => p.x + PW > -5);
        if (newFrame % stats.pipeInterval === 0) {
          const min = 75, max = CANVAS_H - stats.pipeGap - 75;
          newPipes = [...newPipes, { x: CANVAS_W + 10, topH: Math.floor(Math.random() * (max - min + 1)) + min, scored: false }];
        }

        // Score / pipe coins
        let newScore = gs.score;
        let earnedCoins = 0;
        const coinMult = gs.buzzed ? BUZZ_COIN_MULT : 1;
        newPipes = newPipes.map((p) => {
          if (!p.scored && p.x + PW / 2 < BIRD_X) {
            newScore++;
            earnedCoins += stats.coinsPerPipe * coinMult;
            return { ...p, scored: true };
          }
          return p;
        });

        // Cigarettes — spawn
        const spawnInterval = Math.max(120, CIGS_SPAWN_INTERVAL - sd.upgrades.chainSmoker * 15);
        let newCigs = gs.cigarettes
          .map((c) => ({ ...c, x: c.x - stats.pipeSpeed * speedMult }))
          .filter((c) => c.x > -30);

        let cigIdCounter = gs.cigIdCounter;
        if (newFrame % spawnInterval === Math.floor(spawnInterval / 2)) {
          const gy = 60 + Math.random() * (CANVAS_H - 36 - 60 - 60) + 30;
          newCigs = [...newCigs, { id: cigIdCounter++, x: CANVAS_W + 20, y: gy, collected: false }];
        }

        // Cigarette collection
        let cigCollected = 0;
        let newBuzzed = gs.buzzed;
        let newBuzzTimer = gs.buzzTimer;
        newCigs = newCigs.map((c) => {
          if (!c.collected) {
            const dx = BIRD_X - c.x, dy = newBird.y - c.y;
            if (Math.sqrt(dx * dx + dy * dy) < BIRD_R + 14) {
              cigCollected++;
              newBuzzed = true;
              newBuzzTimer = stats.buzzDuration;
              earnedCoins += stats.cigCoinBonus * coinMult;
              return { ...c, collected: true };
            }
          }
          return c;
        });

        // Buzz timer
        if (newBuzzed && !cigCollected) {
          newBuzzTimer = Math.max(0, newBuzzTimer - 1);
          if (newBuzzTimer === 0) newBuzzed = false;
        }

        // Slow timer
        let slowActive = gs.slowActive, slowTimer = gs.slowTimer;
        if (slowActive) { slowTimer = Math.max(0, slowTimer - 1); if (slowTimer === 0) slowActive = false; }

        // Smoke particles (from bird beak when buzzed)
        let newSmoke = gs.smokeParticles
          .map((p) => ({ ...p, x: p.x + p.dx, y: p.y + p.dy, alpha: p.alpha - 0.018, size: p.size + 0.06 }))
          .filter((p) => p.alpha > 0);
        if (newBuzzed && newFrame % 4 === 0) {
          newSmoke = [...newSmoke, {
            x: BIRD_X + 20 + Math.random() * 4,
            y: newBird.y + (Math.random() - 0.5) * 4,
            dx: 0.4 + Math.random() * 0.6,
            dy: -0.5 - Math.random() * 0.8,
            alpha: 0.5 + Math.random() * 0.25,
            size: 3 + Math.random() * 2,
          }];
        }

        // Collision
        const bx = BIRD_X, by = newBird.y, r = BIRD_R - 3;
        let crashed = by - r <= 0 || by + r >= CANVAS_H - 36;
        if (!crashed) {
          for (const p of newPipes) {
            if (bx + r > p.x && bx - r < p.x + PW) {
              if (by - r < p.topH || by + r > p.topH + stats.pipeGap) { crashed = true; break; }
            }
          }
        }

        // Shield
        let shieldActive = gs.shieldActive, shieldUsed = gs.shieldUsed;
        let phase: GameState["phase"] = "playing";
        if (crashed) {
          if (shieldActive && !shieldUsed) { shieldUsed = true; shieldActive = false; }
          else { phase = "dead"; }
        }

        const totalRunCoins = gs.runCoins + earnedCoins;
        if (phase === "dead") {
          persistSave({
            ...sd,
            coins: sd.coins + totalRunCoins,
            bestScore: Math.max(sd.bestScore, newScore),
            totalRuns: sd.totalRuns + 1,
            lifetimeCoins: sd.lifetimeCoins + totalRunCoins,
            cigarettesSmoked: sd.cigarettesSmoked + (cigCollected),
          });
        }

        gameRef.current = {
          ...gs,
          bird: newBird, pipes: newPipes,
          cigarettes: newCigs, smokeParticles: newSmoke,
          score: newScore, runCoins: totalRunCoins, frame: newFrame,
          phase, shieldActive, shieldUsed,
          slowActive, slowTimer,
          buzzed: newBuzzed, buzzTimer: newBuzzTimer,
          cigIdCounter,
        };
      } else if (gs.phase === "idle") {
        bgOffRef.current += 0.4;
        gameRef.current = {
          ...gs, frame: gs.frame + 1,
          bird: { ...gs.bird, y: CANVAS_H / 2 + Math.sin(gs.frame * 0.05) * 8, angle: 0, vy: 0 },
        };
      } else {
        gameRef.current = { ...gs, frame: gs.frame + 1 };
      }

      drawScene(ctx, gameRef.current, bgOffRef.current, sd.upgrades, sd);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [persistSave]);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);

  const gs = gameRef.current;
  const stats = getStats(saveData.upgrades);

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px", gap: "16px", flexWrap: "wrap" }}>
      {/* Game Canvas */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
        <canvas
          ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          onClick={flap}
          onTouchStart={(e) => { e.preventDefault(); flap(); }}
          style={{ borderRadius: 14, boxShadow: "0 8px 40px rgba(0,0,0,0.7)", cursor: "pointer", touchAction: "none", display: "block" }}
        />
        {stats.slowDuration > 0 && (
          <button
            onClick={activateSlow}
            disabled={gs.phase !== "playing" || gs.slowActive}
            style={{
              background: gs.slowActive ? "#6b21a8" : gs.phase === "playing" ? "#7c3aed" : "#374151",
              color: "white", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 14,
              cursor: gs.phase === "playing" && !gs.slowActive ? "pointer" : "default",
              fontWeight: "bold", opacity: gs.phase === "playing" && !gs.slowActive ? 1 : 0.5,
              transition: "all 0.2s",
            }}
          >
            ⏱️ Slow Time {gs.slowActive ? "(active)" : "(S)"}
          </button>
        )}
      </div>

      {/* Shop Panel */}
      <div style={{ width: 290, background: "#1a1f2e", borderRadius: 16, padding: "16px", boxShadow: "0 4px 30px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#F1C40F", fontSize: 22, fontWeight: "bold", letterSpacing: 1 }}>FLAPPY INC.</div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>Idle &amp; Upgrade Shop</div>
        </div>

        {/* Coins + stats */}
        <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#9ca3af", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Coins</div>
            <div style={{ color: "#F1C40F", fontSize: 28, fontWeight: "bold" }}>🪙 {saveData.coins.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#9ca3af", fontSize: 11 }}>Best</div>
            <div style={{ color: "#a3e635", fontSize: 18, fontWeight: "bold" }}>{saveData.bestScore}</div>
            <div style={{ color: "#6b7280", fontSize: 11 }}>Smoked: {saveData.cigarettesSmoked} 🚬</div>
          </div>
        </div>

        <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" }}>
          {[
            ["🪽", "Flap", `${(-stats.flapPower).toFixed(1)}`],
            ["💨", "Speed", `${stats.pipeSpeed.toFixed(2)}`],
            ["📐", "Gap", `${stats.pipeGap}px`],
            ["🪙", "Per pipe", `x${stats.coinsPerPipe}`],
            ["🚬", "Buzz bonus", `+${stats.cigCoinBonus}`],
            ["⏱️", "Buzz dur.", `${(stats.buzzDuration / 60).toFixed(1)}s`],
          ].map(([icon, label, val]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 12 }}>{icon}</span>
              <span style={{ color: "#9ca3af", fontSize: 11 }}>{label}:</span>
              <span style={{ color: "#e5e7eb", fontSize: 11, fontWeight: "bold" }}>{val}</span>
            </div>
          ))}
        </div>

        <div style={{ color: "#9ca3af", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, paddingLeft: 2 }}>Upgrades</div>
        {UPGRADE_DEFS.map(({ key, icon, name, desc }) => {
          const lvl = saveData.upgrades[key];
          const maxed = lvl >= MAX_LEVELS[key];
          const cost = maxed ? 0 : upgradeCost(key, lvl);
          const canAfford = saveData.coins >= cost;
          const isSmokingUpgrade = key === "chainSmoker";

          return (
            <div key={key} style={{
              background: "#111827", borderRadius: 10, padding: "10px 12px",
              border: isSmokingUpgrade && !maxed
                ? (canAfford ? "1px solid #92400e" : "1px solid #1f2937")
                : maxed ? "1px solid #374151" : "1px solid #374151",
              opacity: maxed ? 0.7 : 1,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 16 }}>{icon}</span>
                    <span style={{ color: "#e5e7eb", fontWeight: "bold", fontSize: 13 }}>{name}</span>
                    <span style={{ color: lvl > 0 ? "#a3e635" : "#4b5563", fontSize: 11, fontWeight: "bold" }}>Lv{lvl}/{MAX_LEVELS[key]}</span>
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 11, lineHeight: 1.4 }}>{desc(lvl)}</div>
                  <div style={{ marginTop: 6, background: "#1f2937", borderRadius: 4, height: 4, overflow: "hidden" }}>
                    <div style={{ width: `${(lvl / MAX_LEVELS[key]) * 100}%`, height: "100%", background: maxed ? "#22c55e" : isSmokingUpgrade ? "#f59e0b" : "#7c3aed", borderRadius: 4, transition: "width 0.3s" }} />
                  </div>
                </div>
                {!maxed ? (
                  <button
                    onClick={() => buyUpgrade(key)}
                    disabled={!canAfford}
                    style={{
                      background: canAfford
                        ? isSmokingUpgrade
                          ? "linear-gradient(135deg, #d97706, #b45309)"
                          : "linear-gradient(135deg, #7c3aed, #6d28d9)"
                        : "#1f2937",
                      color: canAfford ? "white" : "#4b5563",
                      border: "none", borderRadius: 8, padding: "6px 10px",
                      fontSize: 12, fontWeight: "bold", cursor: canAfford ? "pointer" : "default",
                      whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.2s",
                      boxShadow: canAfford
                        ? isSmokingUpgrade ? "0 2px 8px rgba(217,119,6,0.5)" : "0 2px 8px rgba(124,58,237,0.4)"
                        : "none",
                    }}
                  >
                    🪙 {cost.toLocaleString()}
                  </button>
                ) : (
                  <div style={{ color: "#22c55e", fontSize: 11, fontWeight: "bold", padding: "6px 8px" }}>MAX</div>
                )}
              </div>
            </div>
          );
        })}

        <button
          onClick={() => {
            if (confirm("Reset all progress? This cannot be undone.")) {
              const fresh: SaveData = { coins: 0, upgrades: { wingPower: 0, tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0 }, bestScore: 0, totalRuns: 0, lifetimeCoins: 0, cigarettesSmoked: 0 };
              persistSave(fresh);
              gameRef.current = makeInitialGame();
            }
          }}
          style={{ background: "transparent", border: "1px solid #374151", color: "#4b5563", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", marginTop: 4 }}
        >
          Reset Progress
        </button>
      </div>
    </div>
  );
}

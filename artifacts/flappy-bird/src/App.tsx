import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@workspace/replit-auth-web";

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
  runCigsSmoked: number;
}

interface SaveData {
  coins: number;
  upgrades: Upgrades;
  bestScore: number;
  totalRuns: number;
  lifetimeCoins: number;
  cigarettesSmoked: number;
  prestigeLevel: number;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  profileImageUrl?: string | null;
  bestScore: number;
  prestigeLevel: number;
  totalRuns: number;
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem("flappy-incremental");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        cigarettesSmoked: 0,
        prestigeLevel: 0,
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
    bestScore: 0, totalRuns: 0, lifetimeCoins: 0, cigarettesSmoked: 0, prestigeLevel: 0,
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

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(1, 2, 16, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyGrad = ctx.createLinearGradient(0, -3, 0, 3);
  bodyGrad.addColorStop(0, "#f8f8f8");
  bodyGrad.addColorStop(1, "#d8d8d8");
  ctx.fillStyle = bodyGrad;
  rr(ctx, -14, -3, 22, 6, 2);
  ctx.fill();

  const tipGrad = ctx.createLinearGradient(0, -3, 0, 3);
  tipGrad.addColorStop(0, "#D2691E");
  tipGrad.addColorStop(1, "#A0522D");
  ctx.fillStyle = tipGrad;
  rr(ctx, 8, -3, 8, 6, 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(8, -3);
  ctx.lineTo(8, 3);
  ctx.stroke();

  ctx.fillStyle = "#ff6b1a";
  ctx.beginPath();
  ctx.arc(-14, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.arc(-14, 0, 2, 0, Math.PI * 2);
  ctx.fill();

  const glow = ctx.createRadialGradient(-14, 0, 1, -14, 0, 9);
  glow.addColorStop(0, "rgba(255,120,0,0.4)");
  glow.addColorStop(1, "rgba(255,120,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(-14, 0, 9, 0, Math.PI * 2);
  ctx.fill();

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

  ctx.fillStyle = buzzed ? "rgba(255,210,80,0.6)" : isSlowed ? "rgba(200,150,255,0.7)" : "rgba(255,255,255,0.55)";
  [[28,38],[75,18],[130,55],[195,12],[250,42],[315,28],[355,65],[45,85],[105,108],[165,78],[225,98],[295,82],[345,118],[18,138],[88,148],[158,128],[238,158],[308,142]].forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.arc(((sx - bgOff * 0.08) % CANVAS_W + CANVAS_W) % CANVAS_W, sy, 1.3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = buzzed ? "rgba(255,200,50,0.08)" : isSlowed ? "rgba(180,100,255,0.1)" : "rgba(255,255,255,0.06)";
  [[60, 170, 85, 28], [220, 210, 65, 22], [330, 190, 75, 26]].forEach(([cx, cy, cw, ch]) => {
    const x = ((cx - bgOff * 0.28) % CANVAS_W + CANVAS_W) % CANVAS_W;
    ctx.beginPath();
    ctx.ellipse(x, cy, cw, ch, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  if (buzzed) {
    const vig = ctx.createRadialGradient(CANVAS_W/2, CANVAS_H/2, 80, CANVAS_W/2, CANVAS_H/2, 290);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(180,120,0,0.3)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (isSlowed) {
    const vig = ctx.createRadialGradient(CANVAS_W/2, CANVAS_H/2, 80, CANVAS_W/2, CANVAS_H/2, 280);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(100,0,200,0.25)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  const PW = 58;
  const pipeGap = stats.pipeGap;

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

  cigarettes.forEach((cig) => {
    if (!cig.collected) drawCigarette(ctx, cig.x, cig.y, state.frame);
  });

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

  smokeParticles.forEach((p) => {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = "#c8c8c8";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(BIRD_X, bird.y);
  ctx.rotate(bird.angle);

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

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(3, 3, BIRD_R, BIRD_R - 2, 0, 0, Math.PI * 2); ctx.fill();

  const bg = ctx.createRadialGradient(-4, -4, 2, 0, 0, BIRD_R);
  bg.addColorStop(0, "#FFE066"); bg.addColorStop(0.6, "#F1C40F"); bg.addColorStop(1, "#D4AC0D");
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(0, 0, BIRD_R, BIRD_R - 2, 0, 0, Math.PI * 2); ctx.fill();

  const wa = Math.sin(state.frame * 0.28) * 0.38;
  ctx.save(); ctx.rotate(wa);
  ctx.fillStyle = "#E67E22";
  ctx.beginPath(); ctx.ellipse(-4, 4, 9, 4.5, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(7, -5, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2c3e50"; ctx.beginPath(); ctx.arc(8, -5, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(9, -6, 1.1, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#E67E22";
  ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(20, 0); ctx.lineTo(12, 3.5); ctx.closePath(); ctx.fill();

  if (buzzed) {
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

  if (phase === "idle") {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    rr(ctx, 30, CANVAS_H / 2 - 100, CANVAS_W - 60, 200, 18); ctx.fill();
    ctx.fillStyle = "#F1C40F"; ctx.font = "bold 38px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 8;
    ctx.fillText("FLAPPY INC.", CANVAS_W / 2, CANVAS_H / 2 - 42);
    ctx.fillStyle = "white"; ctx.font = "16px Arial"; ctx.shadowBlur = 3;
    ctx.fillText("Click / Space to flap", CANVAS_W / 2, CANVAS_H / 2 + 4);
    ctx.fillText("Collect 🚬 for a coin buzz!", CANVAS_W / 2, CANVAS_H / 2 + 28);
    if (saveData.prestigeLevel > 0) {
      ctx.fillStyle = "#f59e0b"; ctx.font = "bold 13px Arial";
      ctx.fillText(`✨ Prestige ${saveData.prestigeLevel}  •  x${(1 + saveData.prestigeLevel * 0.25).toFixed(2)} coins`, CANVAS_W / 2, CANVAS_H / 2 + 54);
    }
    if (saveData.bestScore > 0) {
      ctx.fillStyle = "#a3e635"; ctx.font = "14px Arial";
      ctx.fillText(`Best: ${saveData.bestScore}  •  Smoked: ${saveData.cigarettesSmoked || 0}`, CANVAS_W / 2, CANVAS_H / 2 + saveData.prestigeLevel > 0 ? 76 : 62);
    }
    ctx.shadowBlur = 0;
  }

  if (phase === "dead") {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    rr(ctx, 30, CANVAS_H / 2 - 115, CANVAS_W - 60, 230, 18); ctx.fill();
    ctx.fillStyle = "#ef4444"; ctx.font = "bold 34px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 8;
    ctx.fillText("CRASH!", CANVAS_W / 2, CANVAS_H / 2 - 62);
    ctx.fillStyle = "white"; ctx.font = "20px Arial";
    ctx.fillText(`Score: ${score}`, CANVAS_W / 2, CANVAS_H / 2 - 22);
    ctx.fillStyle = "#F1C40F"; ctx.font = "17px Arial";
    ctx.fillText(`+${runCoins} coins earned`, CANVAS_W / 2, CANVAS_H / 2 + 10);
    if (saveData.prestigeLevel > 0) {
      ctx.fillStyle = "#f59e0b"; ctx.font = "bold 12px Arial";
      ctx.fillText(`✨ Prestige x${(1 + saveData.prestigeLevel * 0.25).toFixed(2)} applied`, CANVAS_W / 2, CANVAS_H / 2 + 30);
    }
    ctx.fillStyle = "#a3e635"; ctx.font = "13px Arial";
    ctx.fillText(`Best: ${saveData.bestScore}  •  Smoked: ${saveData.cigarettesSmoked || 0}`, CANVAS_W / 2, CANVAS_H / 2 + saveData.prestigeLevel > 0 ? 52 : 38);
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
    runCigsSmoked: 0,
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

  const { user, isAuthenticated, isLoading: authLoading, login, logout } = useAuth();

  const [activeTab, setActiveTab] = useState<"shop" | "leaderboard">("shop");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const prevTotalRunsRef = useRef(saveData.totalRuns);

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

  const handlePrestige = useCallback(async () => {
    const sd = saveDataRef.current;
    const pLvl = sd.prestigeLevel || 0;
    const required = Math.ceil(100 * Math.pow(2, pLvl));
    if (sd.bestScore < required) return;

    if (!window.confirm(`Prestige to level ${pLvl + 1}?\n\nAll coins and upgrades reset.\nYou gain a permanent x${(1 + (pLvl + 1) * 0.25).toFixed(2)} coin multiplier.\n\nThis cannot be undone.`)) return;

    const blankUpgrades: Upgrades = { wingPower: 0, tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0 };

    if (isAuthenticated) {
      try {
        const res = await fetch("/api/prestige", { method: "POST", credentials: "include" });
        const data = await res.json() as { prestigeLevel?: number };
        if (res.ok && data.prestigeLevel != null) {
          persistSave({ ...sd, coins: 0, upgrades: blankUpgrades, prestigeLevel: data.prestigeLevel });
          gameRef.current = makeInitialGame();
          return;
        }
      } catch (_) {}
    }

    persistSave({ ...sd, coins: 0, upgrades: blankUpgrades, prestigeLevel: pLvl + 1 });
    gameRef.current = makeInitialGame();
  }, [isAuthenticated, persistSave]);

  useEffect(() => {
    if (activeTab !== "leaderboard") return;
    setLeaderboardLoading(true);
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d: { entries?: LeaderboardEntry[] }) => {
        setLeaderboard(d.entries ?? []);
        setLeaderboardLoading(false);
      })
      .catch(() => setLeaderboardLoading(false));
  }, [activeTab]);

  useEffect(() => {
    if (saveData.totalRuns <= prevTotalRunsRef.current) return;
    prevTotalRunsRef.current = saveData.totalRuns;
    if (!isAuthenticated) return;
    fetch("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        bestScore: saveData.bestScore,
        totalRuns: saveData.totalRuns,
        cigarettesSmoked: saveData.cigarettesSmoked || 0,
        prestigeLevel: saveData.prestigeLevel || 0,
      }),
    }).catch(() => {});
  }, [saveData.totalRuns, saveData.bestScore, saveData.cigarettesSmoked, saveData.prestigeLevel, isAuthenticated]);

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
      const raw = gameRef.current;
      const gs: GameState = {
        cigarettes: [],
        smokeParticles: [],
        buzzed: false,
        buzzTimer: 0,
        cigIdCounter: 0,
        runCigsSmoked: 0,
        ...raw,
      };
      gameRef.current = gs;
      const sd = saveDataRef.current;
      const stats = getStats(sd.upgrades);
      const prestigeMult = 1 + (sd.prestigeLevel || 0) * 0.25;
      const PW = 58;

      if (gs.phase === "playing") {
        const speedMult = gs.slowActive ? 0.3 : 1.0;
        bgOffRef.current += stats.pipeSpeed * speedMult;

        const newVy = gs.bird.vy + GRAVITY * speedMult;
        const newY = gs.bird.y + newVy * speedMult;
        const newAngle = Math.max(-0.5, Math.min(Math.PI / 2.3, newVy * 0.07));
        const newBird: Bird = { y: newY, vy: newVy, angle: newAngle };
        const newFrame = gs.frame + 1;

        let newPipes = gs.pipes.map((p) => ({ ...p, x: p.x - stats.pipeSpeed * speedMult })).filter((p) => p.x + PW > -5);
        const effectivePipeInterval = gs.slowActive ? Math.round(stats.pipeInterval / speedMult) : stats.pipeInterval;
        if (newFrame % effectivePipeInterval === 0) {
          const min = 75, max = CANVAS_H - stats.pipeGap - 75;
          newPipes = [...newPipes, { x: CANVAS_W + 10, topH: Math.floor(Math.random() * (max - min + 1)) + min, scored: false }];
        }

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

        const spawnInterval = Math.max(120, CIGS_SPAWN_INTERVAL - sd.upgrades.chainSmoker * 15);
        let newCigs = gs.cigarettes
          .map((c) => ({ ...c, x: c.x - stats.pipeSpeed * speedMult }))
          .filter((c) => c.x > -30);

        let cigIdCounter = gs.cigIdCounter;
        if (newFrame % spawnInterval === Math.floor(spawnInterval / 2)) {
          const cigSpawnX = CANVAS_W + 20;
          const margin = 22;
          let safeMinY = 50;
          let safeMaxY = CANVAS_H - 36 - 50;
          for (const pipe of newPipes) {
            const relX = cigSpawnX - pipe.x;
            if (relX >= -4 && relX < PW + 4) {
              safeMinY = Math.max(safeMinY, pipe.topH + margin);
              safeMaxY = Math.min(safeMaxY, pipe.topH + stats.pipeGap - margin);
            }
          }
          if (safeMaxY > safeMinY) {
            const gy = safeMinY + Math.random() * (safeMaxY - safeMinY);
            newCigs = [...newCigs, { id: cigIdCounter++, x: cigSpawnX, y: gy, collected: false }];
          }
        }

        let newlyCollected = 0;
        let newBuzzed = gs.buzzed;
        let newBuzzTimer = gs.buzzTimer;
        newCigs = newCigs.map((c) => {
          if (!c.collected) {
            const dx = BIRD_X - c.x, dy = newBird.y - c.y;
            if (Math.sqrt(dx * dx + dy * dy) < BIRD_R + 14) {
              newlyCollected++;
              newBuzzed = true;
              newBuzzTimer = stats.buzzDuration;
              earnedCoins += stats.cigCoinBonus * coinMult;
              return { ...c, collected: true };
            }
          }
          return c;
        });
        const newRunCigsSmoked = gs.runCigsSmoked + newlyCollected;

        if (newBuzzed && !newlyCollected) {
          newBuzzTimer = Math.max(0, newBuzzTimer - 1);
          if (newBuzzTimer === 0) newBuzzed = false;
        }

        let slowActive = gs.slowActive, slowTimer = gs.slowTimer;
        if (slowActive) { slowTimer = Math.max(0, slowTimer - 1); if (slowTimer === 0) slowActive = false; }

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

        const bx = BIRD_X, by = newBird.y, r = BIRD_R - 3;
        let crashed = by - r <= 0 || by + r >= CANVAS_H - 36;
        if (!crashed) {
          for (const p of newPipes) {
            if (bx + r > p.x && bx - r < p.x + PW) {
              if (by - r < p.topH || by + r > p.topH + stats.pipeGap) { crashed = true; break; }
            }
          }
        }

        let shieldActive = gs.shieldActive, shieldUsed = gs.shieldUsed;
        let phase: GameState["phase"] = "playing";
        if (crashed) {
          if (shieldActive && !shieldUsed) { shieldUsed = true; shieldActive = false; }
          else { phase = "dead"; }
        }

        const frameEarnedCoins = Math.floor(earnedCoins * prestigeMult);
        const totalRunCoins = gs.runCoins + frameEarnedCoins;
        if (phase === "dead") {
          persistSave({
            ...sd,
            coins: sd.coins + totalRunCoins,
            bestScore: Math.max(sd.bestScore, newScore),
            totalRuns: sd.totalRuns + 1,
            lifetimeCoins: sd.lifetimeCoins + totalRunCoins,
            cigarettesSmoked: (sd.cigarettesSmoked || 0) + newRunCigsSmoked,
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
          cigIdCounter, runCigsSmoked: newRunCigsSmoked,
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
  const pLvl = saveData.prestigeLevel || 0;
  const prestigeReq = Math.ceil(100 * Math.pow(2, pLvl));
  const canPrestige = saveData.bestScore >= prestigeReq;

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
      <div style={{ width: 290, background: "#1a1f2e", borderRadius: 16, padding: "16px", boxShadow: "0 4px 30px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: "10px", maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#F1C40F", fontSize: 20, fontWeight: "bold", letterSpacing: 1 }}>FLAPPY INC.</div>
            <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 1 }}>Idle &amp; Upgrade Shop</div>
          </div>
          <div>
            {authLoading ? (
              <div style={{ color: "#4b5563", fontSize: 11 }}>...</div>
            ) : isAuthenticated && user ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {user.profileImageUrl && (
                  <img src={user.profileImageUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
                )}
                <button
                  onClick={logout}
                  style={{ background: "transparent", border: "1px solid #374151", color: "#9ca3af", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}
                >
                  Log out
                </button>
              </div>
            ) : (
              <button
                onClick={login}
                style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "white", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: "bold", cursor: "pointer" }}
              >
                Log in
              </button>
            )}
          </div>
        </div>

        {/* Coins + stats */}
        <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#9ca3af", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Coins</div>
            <div style={{ color: "#F1C40F", fontSize: 26, fontWeight: "bold" }}>🪙 {saveData.coins.toLocaleString()}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#9ca3af", fontSize: 11 }}>Best</div>
            <div style={{ color: "#a3e635", fontSize: 18, fontWeight: "bold" }}>{saveData.bestScore}</div>
            <div style={{ color: "#6b7280", fontSize: 11 }}>Smoked: {saveData.cigarettesSmoked || 0} 🚬</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: "#111827", borderRadius: 8, padding: 3, gap: 3 }}>
          {(["shop", "leaderboard"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, background: activeTab === tab ? "#1e293b" : "transparent",
                color: activeTab === tab ? "#e5e7eb" : "#6b7280",
                border: "none", borderRadius: 6, padding: "6px 0", fontSize: 12,
                fontWeight: activeTab === tab ? "bold" : "normal", cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {tab === "shop" ? "🛒 Upgrades" : "🏆 Leaderboard"}
            </button>
          ))}
        </div>

        {/* Shop Tab */}
        {activeTab === "shop" && (
          <>
            <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" }}>
              {[
                ["🪽", "Flap", `${(-stats.flapPower).toFixed(1)}`],
                ["💨", "Speed", `${stats.pipeSpeed.toFixed(2)}`],
                ["📐", "Gap", `${stats.pipeGap}px`],
                ["🪙", "Per pipe", `x${stats.coinsPerPipe}`],
                ["🚬", "Buzz bonus", `+${stats.cigCoinBonus}`],
                ["✨", "Prestige", `x${(1 + pLvl * 0.25).toFixed(2)}`],
              ].map(([icon, label, val]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 12 }}>{icon}</span>
                  <span style={{ color: "#9ca3af", fontSize: 11 }}>{label}:</span>
                  <span style={{ color: label === "Prestige" && pLvl > 0 ? "#f59e0b" : "#e5e7eb", fontSize: 11, fontWeight: "bold" }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Prestige Section */}
            <div style={{
              background: "#110a00", borderRadius: 10, padding: "12px",
              border: canPrestige ? "1px solid #92400e" : "1px solid #1f2937",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <span style={{ color: "#f59e0b", fontWeight: "bold", fontSize: 13 }}>✨ Prestige</span>
                  {pLvl > 0 && <span style={{ color: "#f59e0b", fontSize: 11, marginLeft: 6 }}>Level {pLvl}</span>}
                </div>
                <span style={{ color: "#f59e0b", fontSize: 11 }}>x{(1 + pLvl * 0.25).toFixed(2)} coins</span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
                Reset coins &amp; upgrades for a permanent <strong style={{ color: "#f59e0b" }}>+25% coin bonus</strong>.
                <br />Need best score: <strong style={{ color: canPrestige ? "#a3e635" : "#9ca3af" }}>{prestigeReq}</strong>
                {" "}(yours: <strong style={{ color: saveData.bestScore >= prestigeReq ? "#a3e635" : "#9ca3af" }}>{saveData.bestScore}</strong>)
              </div>
              <button
                onClick={handlePrestige}
                disabled={!canPrestige}
                style={{
                  width: "100%",
                  background: canPrestige
                    ? "linear-gradient(135deg, #d97706, #b45309)"
                    : "#1f2937",
                  color: canPrestige ? "white" : "#4b5563",
                  border: "none", borderRadius: 8, padding: "7px 0", fontSize: 12,
                  fontWeight: "bold", cursor: canPrestige ? "pointer" : "default",
                  transition: "all 0.2s",
                  boxShadow: canPrestige ? "0 2px 10px rgba(217,119,6,0.4)" : "none",
                }}
              >
                {canPrestige ? `Prestige to Level ${pLvl + 1} ✨` : `Score ${prestigeReq} to unlock`}
              </button>
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
                  border: isSmokingUpgrade && !maxed && canAfford ? "1px solid #92400e" : "1px solid #1f2937",
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
                  const fresh: SaveData = { coins: 0, upgrades: { wingPower: 0, tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0 }, bestScore: 0, totalRuns: 0, lifetimeCoins: 0, cigarettesSmoked: 0, prestigeLevel: 0 };
                  persistSave(fresh);
                  gameRef.current = makeInitialGame();
                }
              }}
              style={{ background: "transparent", border: "1px solid #374151", color: "#4b5563", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", marginTop: 4 }}
            >
              Reset Progress
            </button>
          </>
        )}

        {/* Leaderboard Tab */}
        {activeTab === "leaderboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!isAuthenticated && !authLoading && (
              <div style={{ background: "#111827", borderRadius: 10, padding: "12px", textAlign: "center" }}>
                <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8 }}>Log in to appear on the leaderboard</div>
                <button
                  onClick={login}
                  style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "white", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 12, fontWeight: "bold", cursor: "pointer" }}
                >
                  Log in
                </button>
              </div>
            )}

            {leaderboardLoading ? (
              <div style={{ textAlign: "center", color: "#4b5563", padding: "20px 0", fontSize: 13 }}>Loading...</div>
            ) : leaderboard.length === 0 ? (
              <div style={{ textAlign: "center", color: "#4b5563", padding: "20px 0", fontSize: 13 }}>No scores yet. Be the first!</div>
            ) : (
              leaderboard.map((entry) => {
                const isMe = user?.id === entry.userId;
                return (
                  <div
                    key={entry.userId}
                    style={{
                      background: isMe ? "#0f172a" : "#111827",
                      borderRadius: 10, padding: "10px 12px",
                      border: isMe ? "1px solid #3b82f6" : "1px solid #1f2937",
                      display: "flex", alignItems: "center", gap: 10,
                    }}
                  >
                    <div style={{ color: entry.rank <= 3 ? ["#FFD700","#C0C0C0","#CD7F32"][entry.rank - 1] : "#4b5563", fontWeight: "bold", fontSize: 14, minWidth: 22, textAlign: "center" }}>
                      {entry.rank <= 3 ? ["🥇","🥈","🥉"][entry.rank - 1] : `#${entry.rank}`}
                    </div>
                    {entry.profileImageUrl ? (
                      <img src={entry.profileImageUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1f2937", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 13 }}>
                        {entry.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: isMe ? "#93c5fd" : "#e5e7eb", fontSize: 12, fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.username}{isMe ? " (you)" : ""}
                      </div>
                      <div style={{ color: "#6b7280", fontSize: 10 }}>
                        {entry.totalRuns} runs{entry.prestigeLevel > 0 ? ` • ✨ Prestige ${entry.prestigeLevel}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ color: "#a3e635", fontWeight: "bold", fontSize: 14 }}>{entry.bestScore}</div>
                      <div style={{ color: "#4b5563", fontSize: 10 }}>best</div>
                    </div>
                  </div>
                );
              })
            )}

            <button
              onClick={() => {
                setLeaderboardLoading(true);
                fetch("/api/leaderboard")
                  .then((r) => r.json())
                  .then((d: { entries?: LeaderboardEntry[] }) => { setLeaderboard(d.entries ?? []); setLeaderboardLoading(false); })
                  .catch(() => setLeaderboardLoading(false));
              }}
              style={{ background: "transparent", border: "1px solid #374151", color: "#6b7280", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer" }}
            >
              ↻ Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

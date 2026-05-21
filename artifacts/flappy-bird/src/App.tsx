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

// Perk card layout constants (shared between drawScene and choosePerk)
const PERK_CARD_X = 28;
const PERK_CARD_W = 304;
const PERK_CARD_H = 95;
const PERK_CARD_YS = [105, 212, 319] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Upgrades {
  tailWind: number;
  wideGap: number;
  coinBoost: number;
  shield: number;
  slowTime: number;
  chainSmoker: number;
}

const MAX_LEVELS: Upgrades = {
  tailWind: 8, wideGap: 8, coinBoost: 10, shield: 3, slowTime: 5, chainSmoker: 8,
};

const BASE_COSTS: Record<keyof Upgrades, number> = {
  tailWind: 20, wideGap: 25, coinBoost: 15, shield: 80, slowTime: 40, chainSmoker: 18,
};

function upgradeCost(key: keyof Upgrades, level: number): number {
  return Math.floor(BASE_COSTS[key] * Math.pow(1.8, level));
}

type PerkEffect =
  | { type: "gap_bonus"; value: number }
  | { type: "coin_mult"; value: number }
  | { type: "coin_per_pipe"; value: number }
  | { type: "speed_reduction"; value: number }
  | { type: "shield_charge"; value: number }
  | { type: "buzz_duration"; value: number }
  | { type: "cig_coin_bonus"; value: number }
  | { type: "flap_power"; value: number }
  | { type: "cig_spawn_rate"; value: number };

interface PerkDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  rarity: "common" | "uncommon" | "rare";
  effects: PerkEffect[];
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
  phase: "idle" | "playing" | "choosing" | "countdown" | "dead";
  shieldCharges: number;
  slowActive: boolean;
  slowTimer: number;
  buzzed: boolean;
  buzzTimer: number;
  cigIdCounter: number;
  runCigsSmoked: number;
  runPerks: PerkDef[];
  perkChoices: PerkDef[];
  nextMilestone: number;
  pipeSpawnDist: number;
  countdownTimer: number;
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

// ─── Perk Definitions ─────────────────────────────────────────────────────────

const PERK_DEFS: PerkDef[] = [
  // Common
  { id: "updraft",       name: "Updraft",          icon: "🌬️", rarity: "common",
    desc: "+40px pipe gap this run",
    effects: [{ type: "gap_bonus", value: 40 }] },
  { id: "pocket_change", name: "Pocket Change",     icon: "🤑", rarity: "common",
    desc: "+2 coins per pipe this run",
    effects: [{ type: "coin_per_pipe", value: 2 }] },
  { id: "slipstream",    name: "Slipstream",        icon: "🌪️", rarity: "common",
    desc: "Pipes 20% slower this run",
    effects: [{ type: "speed_reduction", value: 0.35 }] },
  { id: "cig_hunter",    name: "Cig Hunter",        icon: "🎯", rarity: "common",
    desc: "Cigarettes spawn 35% more often",
    effects: [{ type: "cig_spawn_rate", value: 0.35 }] },
  { id: "nimble",        name: "Nimble Wings",      icon: "🪽", rarity: "common",
    desc: "Stronger flap power this run",
    effects: [{ type: "flap_power", value: -1.2 }] },
  { id: "quick_puff",    name: "Quick Puff",        icon: "💨", rarity: "common",
    desc: "+10 coins per cigarette",
    effects: [{ type: "cig_coin_bonus", value: 10 }] },
  // Uncommon
  { id: "wide_open",     name: "Wide Open",         icon: "📐", rarity: "uncommon",
    desc: "+70px pipe gap this run",
    effects: [{ type: "gap_bonus", value: 70 }] },
  { id: "cash_flow",     name: "Cash Flow",         icon: "💰", rarity: "uncommon",
    desc: "1.5× all coins this run",
    effects: [{ type: "coin_mult", value: 1.5 }] },
  { id: "buzz_king",     name: "Buzz King",         icon: "👑", rarity: "uncommon",
    desc: "+4 seconds BUZZ duration",
    effects: [{ type: "buzz_duration", value: 240 }] },
  { id: "iron_shell",    name: "Iron Shell",        icon: "🛡️", rarity: "uncommon",
    desc: "+1 shield charge this run",
    effects: [{ type: "shield_charge", value: 1 }] },
  { id: "smoke_pit",     name: "Smoke Pit",         icon: "🚬", rarity: "uncommon",
    desc: "+25 coins per cigarette",
    effects: [{ type: "cig_coin_bonus", value: 25 }] },
  // Rare
  { id: "midas",         name: "Midas Touch",       icon: "✨", rarity: "rare",
    desc: "2.5× all coin earnings this run",
    effects: [{ type: "coin_mult", value: 2.5 }] },
  { id: "fortress",      name: "Fortress",          icon: "🏰", rarity: "rare",
    desc: "+3 shield charges & +60px gap",
    effects: [{ type: "shield_charge", value: 3 }, { type: "gap_bonus", value: 60 }] },
  { id: "ghost_puff",    name: "Ghost Puff",        icon: "👻", rarity: "rare",
    desc: "Pipes 40% slower & +50px gap",
    effects: [{ type: "speed_reduction", value: 0.7 }, { type: "gap_bonus", value: 50 }] },
];

function generatePerkChoices(currentRunPerks: PerkDef[]): PerkDef[] {
  const alreadyHave = new Set(currentRunPerks.map((p) => p.id));
  const pool = PERK_DEFS.filter((p) => !alreadyHave.has(p.id));
  if (pool.length === 0) return [];

  const chosen: PerkDef[] = [];
  const remaining = [...pool];

  while (chosen.length < 3 && remaining.length > 0) {
    const weights = remaining.map((p) => p.rarity === "rare" ? 5 : p.rarity === "uncommon" ? 30 : 65);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = remaining.length - 1;
    for (let j = 0; j < weights.length; j++) { r -= weights[j]; if (r <= 0) { idx = j; break; } }
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return chosen;
}

function nextMilestoneAfter(m: number): number {
  return m + Math.floor(m / 2) + 5;
}

// ─── Save helpers ─────────────────────────────────────────────────────────────

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem("flappy-incremental");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        cigarettesSmoked: 0, prestigeLevel: 0,
        ...parsed,
        upgrades: {
          tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0,
          ...parsed.upgrades,
        },
      };
    }
  } catch (_) {}
  return {
    coins: 0,
    upgrades: { tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0 },
    bestScore: 0, totalRuns: 0, lifetimeCoins: 0, cigarettesSmoked: 0, prestigeLevel: 0,
  };
}

function saveSave(data: SaveData) {
  localStorage.setItem("flappy-incremental", JSON.stringify(data));
}

// ─── Derived stats ────────────────────────────────────────────────────────────

function getStats(u: Upgrades, runPerks: PerkDef[] = []) {
  let flapPower = BASE_FLAP;
  let pipeSpeed = Math.max(1.0, BASE_PIPE_SPEED - u.tailWind * 0.18);
  let pipeGap = BASE_PIPE_GAP + u.wideGap * 18;
  let coinsPerPipe = 1 + u.coinBoost;
  let shieldCharges = u.shield;
  let slowDuration = u.slowTime * 120;
  let pipeInterval = Math.max(55, BASE_PIPE_INTERVAL - u.tailWind * 2);
  let buzzDuration = BUZZ_BASE_DURATION + u.chainSmoker * 80;
  let cigCoinBonus = 8 + u.chainSmoker * 4;
  let coinMult = 1;
  let cigSpawnReduction = 0;

  for (const perk of runPerks) {
    for (const e of perk.effects) {
      switch (e.type) {
        case "gap_bonus":      pipeGap += e.value; break;
        case "coin_mult":      coinMult *= e.value; break;
        case "coin_per_pipe":  coinsPerPipe += e.value; break;
        case "speed_reduction": pipeSpeed = Math.max(0.8, pipeSpeed - e.value); break;
        case "shield_charge":  shieldCharges += e.value; break;
        case "buzz_duration":  buzzDuration += e.value; break;
        case "cig_coin_bonus": cigCoinBonus += e.value; break;
        case "flap_power":     flapPower += e.value; break;
        case "cig_spawn_rate": cigSpawnReduction += e.value; break;
      }
    }
  }

  return {
    flapPower, pipeSpeed, pipeGap, coinsPerPipe, coinMult,
    shieldCharges, slowDuration, pipeInterval, buzzDuration, cigCoinBonus, cigSpawnReduction,
  };
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
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
  ctx.beginPath(); ctx.ellipse(1, 2, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
  const bodyGrad = ctx.createLinearGradient(0, -3, 0, 3);
  bodyGrad.addColorStop(0, "#f8f8f8"); bodyGrad.addColorStop(1, "#d8d8d8");
  ctx.fillStyle = bodyGrad; rr(ctx, -14, -3, 22, 6, 2); ctx.fill();
  const tipGrad = ctx.createLinearGradient(0, -3, 0, 3);
  tipGrad.addColorStop(0, "#D2691E"); tipGrad.addColorStop(1, "#A0522D");
  ctx.fillStyle = tipGrad; rr(ctx, 8, -3, 8, 6, 2); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(8, 3); ctx.stroke();
  ctx.fillStyle = "#ff6b1a"; ctx.beginPath(); ctx.arc(-14, 0, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffcc00"; ctx.beginPath(); ctx.arc(-14, 0, 2, 0, Math.PI * 2); ctx.fill();
  const glow = ctx.createRadialGradient(-14, 0, 1, -14, 0, 9);
  glow.addColorStop(0, "rgba(255,120,0,0.4)"); glow.addColorStop(1, "rgba(255,120,0,0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(-14, 0, 9, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const t = (frame * 0.05 + i * 0.9) % 1;
    ctx.globalAlpha = (1 - t) * 0.35;
    ctx.fillStyle = "#cccccc";
    ctx.beginPath(); ctx.arc(-14 - t * 10, -t * 14 + Math.sin(t * 8 + i) * 4, 2.5 + t * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─── Perk rarity colours (shared) ────────────────────────────────────────────

const RARITY_COLOR: Record<string, string> = { common: "#6b7280", uncommon: "#7c3aed", rare: "#f59e0b" };
const RARITY_BG: Record<string, string>    = { common: "#0f172a", uncommon: "#0f0820", rare: "#0f0900" };

// ─── Main draw ────────────────────────────────────────────────────────────────

function drawScene(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  bgOff: number,
  upgrades: Upgrades,
  saveData: SaveData
) {
  const { bird, pipes, cigarettes = [], smokeParticles = [], score, phase, runCoins, buzzed = false, buzzTimer = 0 } = state;
  const stats = getStats(upgrades, state.runPerks);
  const isSlowed = state.slowActive;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H - 36);
  if (buzzed) {
    sky.addColorStop(0, "#1a1200"); sky.addColorStop(0.6, "#2a1e04"); sky.addColorStop(1, "#1a1000");
  } else if (isSlowed) {
    sky.addColorStop(0, "#1a0a2e"); sky.addColorStop(1, "#3a0a6e");
  } else {
    sky.addColorStop(0, "#0d1b2a"); sky.addColorStop(0.6, "#1b3a5c"); sky.addColorStop(1, "#0f3460");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H - 36);

  // Stars
  ctx.fillStyle = buzzed ? "rgba(255,210,80,0.6)" : isSlowed ? "rgba(200,150,255,0.7)" : "rgba(255,255,255,0.55)";
  [[28,38],[75,18],[130,55],[195,12],[250,42],[315,28],[355,65],[45,85],[105,108],[165,78],[225,98],[295,82],[345,118],[18,138],[88,148],[158,128],[238,158],[308,142]].forEach(([sx, sy]) => {
    ctx.beginPath(); ctx.arc(((sx - bgOff * 0.08) % CANVAS_W + CANVAS_W) % CANVAS_W, sy, 1.3, 0, Math.PI * 2); ctx.fill();
  });

  // Clouds
  ctx.fillStyle = buzzed ? "rgba(255,200,50,0.08)" : isSlowed ? "rgba(180,100,255,0.1)" : "rgba(255,255,255,0.06)";
  [[60,170,85,28],[220,210,65,22],[330,190,75,26]].forEach(([cx, cy, cw, ch]) => {
    const x = ((cx - bgOff * 0.28) % CANVAS_W + CANVAS_W) % CANVAS_W;
    ctx.beginPath(); ctx.ellipse(x, cy, cw, ch, 0, 0, Math.PI * 2); ctx.fill();
  });

  if (buzzed) {
    const vig = ctx.createRadialGradient(CANVAS_W/2, CANVAS_H/2, 80, CANVAS_W/2, CANVAS_H/2, 290);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(180,120,0,0.3)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  if (isSlowed) {
    const vig = ctx.createRadialGradient(CANVAS_W/2, CANVAS_H/2, 80, CANVAS_W/2, CANVAS_H/2, 280);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(100,0,200,0.25)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // Pipes
  const PW = 58;
  const pipeGap = stats.pipeGap;
  pipes.forEach((pipe) => {
    const botY = pipe.topH + pipeGap, botH = CANVAS_H - 36 - botY;
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

  // Cigarettes
  cigarettes.forEach((cig) => { if (!cig.collected) drawCigarette(ctx, cig.x, cig.y, state.frame); });

  // Ground
  const grd = ctx.createLinearGradient(0, CANVAS_H - 36, 0, CANVAS_H);
  grd.addColorStop(0, "#8b6914"); grd.addColorStop(0.3, "#a0791c"); grd.addColorStop(1, "#6b4f10");
  ctx.fillStyle = grd; ctx.fillRect(0, CANVAS_H - 36, CANVAS_W, 36);
  ctx.fillStyle = "#2ecc71"; ctx.fillRect(0, CANVAS_H - 36, CANVAS_W, 7);
  for (let i = 0; i < 9; i++) {
    const lx = ((i * 48) - (bgOff * 2) % 48 + 48) % CANVAS_W;
    ctx.strokeStyle = "rgba(0,0,0,0.13)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, CANVAS_H - 28); ctx.lineTo(lx + 26, CANVAS_H); ctx.stroke();
  }

  // Smoke particles
  smokeParticles.forEach((p) => {
    ctx.globalAlpha = p.alpha; ctx.fillStyle = "#c8c8c8";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Bird
  ctx.save();
  ctx.translate(BIRD_X, bird.y);
  ctx.rotate(bird.angle);

  if (state.shieldCharges > 0) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(state.frame * 0.15) * 0.15;
    const aura = ctx.createRadialGradient(0, 0, BIRD_R, 0, 0, BIRD_R + 12);
    aura.addColorStop(0, "#00d2ff"); aura.addColorStop(1, "rgba(0,210,255,0)");
    ctx.fillStyle = aura; ctx.beginPath(); ctx.arc(0, 0, BIRD_R + 12, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.restore();
  }
  if (buzzed) {
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.sin(state.frame * 0.2) * 0.12;
    const ba = ctx.createRadialGradient(0, 0, BIRD_R, 0, 0, BIRD_R + 14);
    ba.addColorStop(0, "#ffcc00"); ba.addColorStop(1, "rgba(255,180,0,0)");
    ctx.fillStyle = ba; ctx.beginPath(); ctx.arc(0, 0, BIRD_R + 14, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.restore();
  }
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(3, 3, BIRD_R, BIRD_R - 2, 0, 0, Math.PI * 2); ctx.fill();
  const bg = ctx.createRadialGradient(-4, -4, 2, 0, 0, BIRD_R);
  bg.addColorStop(0, "#FFE066"); bg.addColorStop(0.6, "#F1C40F"); bg.addColorStop(1, "#D4AC0D");
  ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, 0, BIRD_R, BIRD_R - 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.rotate(Math.sin(state.frame * 0.28) * 0.38);
  ctx.fillStyle = "#E67E22"; ctx.beginPath(); ctx.ellipse(-4, 4, 9, 4.5, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(7, -5, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2c3e50"; ctx.beginPath(); ctx.arc(8, -5, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "white"; ctx.beginPath(); ctx.arc(9, -6, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#E67E22";
  ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(20, 0); ctx.lineTo(12, 3.5); ctx.closePath(); ctx.fill();
  if (buzzed) {
    ctx.save(); ctx.translate(20, 1); ctx.rotate(0.25);
    ctx.fillStyle = "#e8e8e8"; rr(ctx, 0, -1.5, 10, 3, 1); ctx.fill();
    ctx.fillStyle = "#A0522D"; rr(ctx, 7, -1.5, 4, 3, 1); ctx.fill();
    ctx.fillStyle = "#ff4500"; ctx.beginPath(); ctx.arc(10, 0, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // HUD (playing / dead)
  if (phase === "playing" || phase === "dead") {
    ctx.fillStyle = "white"; ctx.font = "bold 36px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 6;
    ctx.fillText(String(score), CANVAS_W / 2, 55);
    ctx.shadowBlur = 0;

    ctx.font = "bold 15px Arial"; ctx.fillStyle = "#F1C40F"; ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4;
    ctx.fillText(`🪙 +${runCoins}`, 10, 55);
    ctx.shadowBlur = 0;

    // Shield charges HUD
    if (state.shieldCharges > 0) {
      ctx.fillStyle = "#00d2ff"; ctx.font = "bold 13px Arial"; ctx.textAlign = "left";
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4;
      ctx.fillText("🛡️ ×" + state.shieldCharges, 10, 75);
      ctx.shadowBlur = 0;
    }

    // BUZZ bar
    if (buzzed) {
      const frac = buzzTimer / stats.buzzDuration;
      ctx.fillStyle = "rgba(0,0,0,0.4)"; rr(ctx, CANVAS_W - 105, 10, 95, 13, 6); ctx.fill();
      const buzzBarGrad = ctx.createLinearGradient(CANVAS_W - 105, 0, CANVAS_W - 10, 0);
      buzzBarGrad.addColorStop(0, "#f59e0b"); buzzBarGrad.addColorStop(1, "#ef4444");
      ctx.fillStyle = buzzBarGrad; rr(ctx, CANVAS_W - 105, 10, 95 * frac, 13, 6); ctx.fill();
      ctx.fillStyle = "white"; ctx.font = "bold 10px Arial"; ctx.textAlign = "center";
      ctx.fillText("🚬 BUZZED! x" + BUZZ_COIN_MULT, CANVAS_W - 57, 21);
    }
    // Slow bar
    if (state.slowActive) {
      const frac = state.slowTimer / stats.slowDuration;
      const barY = buzzed ? 28 : 10;
      ctx.fillStyle = "rgba(0,0,0,0.4)"; rr(ctx, CANVAS_W - 105, barY, 95, 12, 6); ctx.fill();
      ctx.fillStyle = "#a855f7"; rr(ctx, CANVAS_W - 105, barY, 95 * frac, 12, 6); ctx.fill();
      ctx.fillStyle = "white"; ctx.font = "10px Arial"; ctx.textAlign = "center";
      ctx.fillText("SLOW TIME", CANVAS_W - 57, barY + 10);
    }
  }

  // Idle overlay
  if (phase === "idle") {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    rr(ctx, 30, CANVAS_H / 2 - 105, CANVAS_W - 60, 210, 18); ctx.fill();
    ctx.fillStyle = "#F1C40F"; ctx.font = "bold 38px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 8;
    ctx.fillText("FLAPPY INC.", CANVAS_W / 2, CANVAS_H / 2 - 46);
    ctx.fillStyle = "white"; ctx.font = "16px Arial"; ctx.shadowBlur = 3;
    ctx.fillText("Click / Space to flap", CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillText("Collect 🚬 for a coin buzz!", CANVAS_W / 2, CANVAS_H / 2 + 24);
    ctx.fillStyle = "#a3e635"; ctx.font = "13px Arial";
    ctx.fillText("Reach score milestones to pick perks!", CANVAS_W / 2, CANVAS_H / 2 + 48);
    if (saveData.prestigeLevel > 0) {
      ctx.fillStyle = "#f59e0b"; ctx.font = "bold 13px Arial";
      ctx.fillText(`✨ Prestige ${saveData.prestigeLevel}  •  x${(1 + saveData.prestigeLevel * 0.25).toFixed(2)} coins`, CANVAS_W / 2, CANVAS_H / 2 + 74);
    }
    if (saveData.bestScore > 0) {
      ctx.fillStyle = "#9ca3af"; ctx.font = "12px Arial";
      ctx.fillText(`Best: ${saveData.bestScore}  •  Smoked: ${saveData.cigarettesSmoked || 0}`, CANVAS_W / 2, CANVAS_H / 2 + saveData.prestigeLevel > 0 ? 96 : 74);
    }
    ctx.shadowBlur = 0;
  }

  // Dead overlay
  if (phase === "dead") {
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    rr(ctx, 30, CANVAS_H / 2 - 120, CANVAS_W - 60, 240, 18); ctx.fill();
    ctx.fillStyle = "#ef4444"; ctx.font = "bold 34px Arial"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 8;
    ctx.fillText("CRASH!", CANVAS_W / 2, CANVAS_H / 2 - 68);
    ctx.fillStyle = "white"; ctx.font = "20px Arial";
    ctx.fillText(`Score: ${score}`, CANVAS_W / 2, CANVAS_H / 2 - 28);
    ctx.fillStyle = "#F1C40F"; ctx.font = "17px Arial";
    ctx.fillText(`+${runCoins} coins earned`, CANVAS_W / 2, CANVAS_H / 2 + 4);
    if (saveData.prestigeLevel > 0) {
      ctx.fillStyle = "#f59e0b"; ctx.font = "bold 12px Arial";
      ctx.fillText(`✨ Prestige x${(1 + saveData.prestigeLevel * 0.25).toFixed(2)} applied`, CANVAS_W / 2, CANVAS_H / 2 + 24);
    }
    if (state.runPerks.length > 0) {
      ctx.fillStyle = "#6b7280"; ctx.font = "11px Arial";
      ctx.fillText("Perks: " + state.runPerks.map((p) => p.icon).join(" "), CANVAS_W / 2, CANVAS_H / 2 + 44);
    }
    ctx.fillStyle = "#a3e635"; ctx.font = "13px Arial";
    ctx.fillText(`Best: ${saveData.bestScore}  •  Smoked: ${saveData.cigarettesSmoked || 0}`, CANVAS_W / 2, CANVAS_H / 2 + 64);
    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.font = "15px Arial";
    ctx.fillText("Click or Space to try again", CANVAS_W / 2, CANVAS_H / 2 + 90);
    ctx.shadowBlur = 0;
  }

  // Choosing overlay (roguelike perk selection)
  if (phase === "choosing") {
    ctx.fillStyle = "rgba(0,0,0,0.84)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.textAlign = "center";
    ctx.fillStyle = "#f59e0b"; ctx.font = "bold 26px Arial";
    ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 10;
    ctx.fillText("✨ LEVEL UP!", CANVAS_W / 2, 50);
    ctx.fillStyle = "white"; ctx.font = "14px Arial"; ctx.shadowBlur = 3;
    ctx.fillText("Choose a perk", CANVAS_W / 2, 73);
    ctx.fillStyle = "#6b7280"; ctx.font = "12px Arial"; ctx.shadowBlur = 0;
    ctx.fillText(`Score: ${score}  •  Next: ${nextMilestoneAfter(state.nextMilestone)}`, CANVAS_W / 2, 91);

    state.perkChoices.forEach((perk, i) => {
      const cardY = PERK_CARD_YS[i];
      const rColor = RARITY_COLOR[perk.rarity];
      const rBg = RARITY_BG[perk.rarity];

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      rr(ctx, PERK_CARD_X + 2, cardY + 2, PERK_CARD_W, PERK_CARD_H, 10); ctx.fill();
      // Card
      ctx.fillStyle = rBg;
      rr(ctx, PERK_CARD_X, cardY, PERK_CARD_W, PERK_CARD_H, 10); ctx.fill();
      ctx.strokeStyle = rColor; ctx.lineWidth = 1.5;
      rr(ctx, PERK_CARD_X, cardY, PERK_CARD_W, PERK_CARD_H, 10); ctx.stroke();
      // Icon
      ctx.font = "30px Arial"; ctx.textAlign = "left";
      ctx.fillText(perk.icon, PERK_CARD_X + 12, cardY + 40);
      // Name
      ctx.fillStyle = "white"; ctx.font = "bold 15px Arial";
      ctx.fillText(perk.name, PERK_CARD_X + 54, cardY + 26);
      // Rarity
      ctx.fillStyle = rColor; ctx.font = "bold 10px Arial";
      ctx.fillText(perk.rarity.toUpperCase(), PERK_CARD_X + 54, cardY + 41);
      // Desc
      ctx.fillStyle = "#d1d5db"; ctx.font = "12px Arial";
      ctx.fillText(perk.desc, PERK_CARD_X + 14, cardY + 60);
      // Hint
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.font = "10px Arial";
      ctx.textAlign = "right";
      ctx.fillText("tap to select →", PERK_CARD_X + PERK_CARD_W - 10, cardY + PERK_CARD_H - 8);
    });

    // Active perks row
    if (state.runPerks.length > 0) {
      ctx.textAlign = "center"; ctx.fillStyle = "#4b5563"; ctx.font = "11px Arial";
      ctx.fillText("Active: " + state.runPerks.map((p) => p.icon).join(" "), CANVAS_W / 2, 440);
    }

    ctx.shadowBlur = 0;
  }

  // Countdown overlay
  if (phase === "countdown") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Show the perk that was just picked
    const lastPerk = state.runPerks[state.runPerks.length - 1];
    if (lastPerk) {
      const rColor = RARITY_COLOR[lastPerk.rarity];
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      rr(ctx, 28, 55, PERK_CARD_W, 52, 10); ctx.fill();
      ctx.strokeStyle = rColor; ctx.lineWidth = 1.5;
      rr(ctx, 28, 55, PERK_CARD_W, 52, 10); ctx.stroke();
      ctx.font = "22px Arial"; ctx.textAlign = "left";
      ctx.fillText(lastPerk.icon, 42, 91);
      ctx.fillStyle = "white"; ctx.font = "bold 14px Arial";
      ctx.fillText(lastPerk.name, 76, 78);
      ctx.fillStyle = rColor; ctx.font = "bold 10px Arial";
      ctx.fillText(lastPerk.rarity.toUpperCase() + "  •  " + lastPerk.desc, 76, 94);
    }

    // Pulsing "press space" prompt
    const pulse = 0.55 + 0.45 * Math.sin((state.frame / 30) * Math.PI);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "#a3e635"; ctx.shadowBlur = 16;
    ctx.fillText("PRESS SPACE or TAP to continue", CANVAS_W / 2, CANVAS_H / 2 + 48);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

// ─── Upgrade Config ───────────────────────────────────────────────────────────

const UPGRADE_DEFS: { key: keyof Upgrades; name: string; desc: (lvl: number) => string; icon: string }[] = [
  { key: "tailWind",    icon: "💨", name: "Tail Wind",    desc: (l) => `Pipe speed -${(l * 0.18).toFixed(2)} → more time to react` },
  { key: "wideGap",     icon: "📐", name: "Wide Gap",     desc: (l) => `Gap +${l * 18}px → easier to pass` },
  { key: "coinBoost",   icon: "🪙", name: "Coin Boost",   desc: (l) => `${1 + l} coin${1 + l > 1 ? "s" : ""} per pipe base` },
  { key: "shield",      icon: "🛡️", name: "Shield",       desc: (l) => l === 0 ? "Unlock shield charges" : `${l} shield charge${l > 1 ? "s" : ""} per run (more from perks!)` },
  { key: "slowTime",    icon: "⏱️", name: "Slow Time",    desc: (l) => l === 0 ? "Unlock slow-time (press S)" : `Slow lasts ${l * 2}s per run` },
  { key: "chainSmoker", icon: "🚬", name: "Chain Smoker", desc: (l) => l === 0 ? "More cigarettes + bigger buzz" : `Buzz ${(BUZZ_BASE_DURATION / 60 + l * 80 / 60).toFixed(1)}s, +${8 + l * 4} coins/cig` },
];

// ─── Main Component ───────────────────────────────────────────────────────────

function makeInitialGame(initialShieldCharges = 0): GameState {
  return {
    bird: { y: CANVAS_H / 2, vy: 0, angle: 0 },
    pipes: [], cigarettes: [], smokeParticles: [],
    score: 0, runCoins: 0, frame: 0,
    phase: "idle",
    shieldCharges: initialShieldCharges,
    slowActive: false, slowTimer: 0,
    buzzed: false, buzzTimer: 0,
    cigIdCounter: 0, runCigsSmoked: 0,
    runPerks: [], perkChoices: [],
    nextMilestone: 5,
    pipeSpawnDist: BASE_PIPE_INTERVAL * BASE_PIPE_SPEED,
    countdownTimer: 0,
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

  // ── Perk selection (canvas coordinate hit-test) ──────────────────────────
  const choosePerk = useCallback((cx: number, cy: number) => {
    const gs = gameRef.current;
    if (gs.phase !== "choosing" || gs.perkChoices.length === 0) return;

    for (let i = 0; i < gs.perkChoices.length; i++) {
      const cardY = PERK_CARD_YS[i];
      if (cx >= PERK_CARD_X && cx <= PERK_CARD_X + PERK_CARD_W && cy >= cardY && cy <= cardY + PERK_CARD_H) {
        const chosen = gs.perkChoices[i];
        const newRunPerks = [...gs.runPerks, chosen];
        let extraShield = 0;
        for (const e of chosen.effects) {
          if (e.type === "shield_charge") extraShield += e.value;
        }
        gameRef.current = {
          ...gs,
          phase: "countdown",
          countdownTimer: 150,
          runPerks: newRunPerks,
          perkChoices: [],
          nextMilestone: nextMilestoneAfter(gs.nextMilestone),
          shieldCharges: gs.shieldCharges + extraShield,
        };
        return;
      }
    }
  }, []);

  const flap = useCallback(() => {
    const gs = gameRef.current;
    if (gs.phase === "choosing" || gs.phase === "countdown") return;
    const sd = saveDataRef.current;
    const stats = getStats(sd.upgrades, gs.runPerks);
    if (gs.phase === "idle") {
      gameRef.current = { ...gs, phase: "playing", bird: { ...gs.bird, vy: stats.flapPower }, shieldCharges: sd.upgrades.shield };
    } else if (gs.phase === "playing") {
      gameRef.current = { ...gs, bird: { ...gs.bird, vy: stats.flapPower } };
    } else if (gs.phase === "dead") {
      gameRef.current = makeInitialGame(sd.upgrades.shield);
    }
  }, []);

  const activateSlow = useCallback(() => {
    const gs = gameRef.current;
    const sd = saveDataRef.current;
    const stats = getStats(sd.upgrades, gs.runPerks);
    if (gs.phase !== "playing" || gs.slowActive || stats.slowDuration === 0) return;
    gameRef.current = { ...gs, slowActive: true, slowTimer: stats.slowDuration };
  }, []);

  const handlePrestige = useCallback(async () => {
    const sd = saveDataRef.current;
    const pLvl = sd.prestigeLevel || 0;
    const required = Math.ceil(100 * Math.pow(2, pLvl));
    if (sd.bestScore < required) return;
    if (!window.confirm(`Prestige to level ${pLvl + 1}?\n\nAll coins and upgrades reset.\nYou gain a permanent x${(1 + (pLvl + 1) * 0.25).toFixed(2)} coin multiplier.\n\nThis cannot be undone.`)) return;
    const blankUpgrades: Upgrades = { tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0 };
    if (isAuthenticated) {
      try {
        const res = await fetch("/api/prestige", { method: "POST", credentials: "include" });
        const data = await res.json() as { prestigeLevel?: number };
        if (res.ok && data.prestigeLevel != null) {
          persistSave({ ...sd, coins: 0, upgrades: blankUpgrades, prestigeLevel: data.prestigeLevel });
          gameRef.current = makeInitialGame(0);
          return;
        }
      } catch (_) {}
    }
    persistSave({ ...sd, coins: 0, upgrades: blankUpgrades, prestigeLevel: pLvl + 1 });
    gameRef.current = makeInitialGame(0);
  }, [isAuthenticated, persistSave]);

  const resumeFromCountdown = useCallback(() => {
    const gs = gameRef.current;
    if (gs.phase !== "countdown") return;
    gameRef.current = { ...gs, phase: "playing", countdownTimer: 0 };
  }, []);

  // ── Canvas click/touch ──────────────────────────────────────────────────
  const handleCanvasInteract = useCallback((clientX: number, clientY: number) => {
    const gs = gameRef.current;
    if (gs.phase === "choosing") {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      choosePerk(
        (clientX - rect.left) * (CANVAS_W / rect.width),
        (clientY - rect.top) * (CANVAS_H / rect.height)
      );
    } else if (gs.phase === "countdown") {
      resumeFromCountdown();
    } else {
      flap();
    }
  }, [flap, choosePerk, resumeFromCountdown]);

  // ── Leaderboard fetch ────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== "leaderboard") return;
    setLeaderboardLoading(true);
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d: { entries?: LeaderboardEntry[] }) => { setLeaderboard(d.entries ?? []); setLeaderboardLoading(false); })
      .catch(() => setLeaderboardLoading(false));
  }, [activeTab]);

  // ── Score submission after each run ─────────────────────────────────────
  useEffect(() => {
    if (saveData.totalRuns <= prevTotalRunsRef.current) return;
    prevTotalRunsRef.current = saveData.totalRuns;
    if (!isAuthenticated) return;
    fetch("/api/scores", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        bestScore: saveData.bestScore, totalRuns: saveData.totalRuns,
        cigarettesSmoked: saveData.cigarettesSmoked || 0, prestigeLevel: saveData.prestigeLevel || 0,
      }),
    }).catch(() => {});
  }, [saveData.totalRuns, saveData.bestScore, saveData.cigarettesSmoked, saveData.prestigeLevel, isAuthenticated]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " " || e.key === "ArrowUp") {
        e.preventDefault();
        if (gameRef.current.phase === "countdown") { resumeFromCountdown(); }
        else { flap(); }
      }
      if (e.key === "s" || e.key === "S") activateSlow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flap, activateSlow, resumeFromCountdown]);

  // ── Game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function loop() {
      const raw = gameRef.current;
      const gs: GameState = { cigarettes: [], smokeParticles: [], buzzed: false, buzzTimer: 0, cigIdCounter: 0, runCigsSmoked: 0, ...raw };
      gameRef.current = gs;
      const sd = saveDataRef.current;
      const stats = getStats(sd.upgrades, gs.runPerks);
      const prestigeMult = 1 + (sd.prestigeLevel || 0) * 0.25;
      const PW = 58;

      if (gs.phase === "choosing") {
        drawScene(ctx, gs, bgOffRef.current, sd.upgrades, sd);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      if (gs.phase === "countdown") {
        // Just tick the frame for the pulse animation; wait for user to press Space/tap
        gameRef.current = { ...gs, frame: gs.frame + 1 };
        drawScene(ctx, gameRef.current, bgOffRef.current, sd.upgrades, sd);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      if (gs.phase === "playing") {
        const speedMult = gs.slowActive ? 0.3 : 1.0;
        bgOffRef.current += stats.pipeSpeed * speedMult;

        const newVy = gs.bird.vy + GRAVITY * speedMult;
        const newY = gs.bird.y + newVy * speedMult;
        const newBird: Bird = { y: newY, vy: newVy, angle: Math.max(-0.5, Math.min(Math.PI / 2.3, newVy * 0.07)) };
        const newFrame = gs.frame + 1;

        let newPipes = gs.pipes.map((p) => ({ ...p, x: p.x - stats.pipeSpeed * speedMult })).filter((p) => p.x + PW > -5);
        // Pixel-distance-based spawning: always stats.pipeInterval * stats.pipeSpeed pixels apart
        // regardless of speedMult, so slow time never bunches pipes.
        let newPipeSpawnDist = gs.pipeSpawnDist - stats.pipeSpeed * speedMult;
        if (newPipeSpawnDist <= 0) {
          const min = 75, max = CANVAS_H - stats.pipeGap - 75;
          newPipes = [...newPipes, { x: CANVAS_W + 10, topH: Math.floor(Math.random() * (max - min + 1)) + min, scored: false }];
          newPipeSpawnDist += stats.pipeInterval * stats.pipeSpeed;
        }

        let newScore = gs.score;
        let earnedCoins = 0;
        const buzzMult = gs.buzzed ? BUZZ_COIN_MULT : 1;
        let triggeredMilestone = false;

        newPipes = newPipes.map((p) => {
          if (!p.scored && p.x + PW / 2 < BIRD_X) {
            newScore++;
            earnedCoins += stats.coinsPerPipe * buzzMult * stats.coinMult;
            if (newScore >= gs.nextMilestone && gs.score < gs.nextMilestone) triggeredMilestone = true;
            return { ...p, scored: true };
          }
          return p;
        });

        const spawnInterval = Math.max(80, (CIGS_SPAWN_INTERVAL - sd.upgrades.chainSmoker * 15) * (1 - stats.cigSpawnReduction));
        let newCigs = gs.cigarettes.map((c) => ({ ...c, x: c.x - stats.pipeSpeed * speedMult })).filter((c) => c.x > -30);
        let cigIdCounter = gs.cigIdCounter;
        if (newFrame % Math.round(spawnInterval) === Math.floor(spawnInterval / 2)) {
          const cigX = CANVAS_W + 20;
          let safeMinY = 50, safeMaxY = CANVAS_H - 36 - 50;
          const margin = 22;
          for (const pipe of newPipes) {
            const relX = cigX - pipe.x;
            if (relX >= -4 && relX < PW + 4) {
              safeMinY = Math.max(safeMinY, pipe.topH + margin);
              safeMaxY = Math.min(safeMaxY, pipe.topH + stats.pipeGap - margin);
            }
          }
          if (safeMaxY > safeMinY) {
            newCigs = [...newCigs, { id: cigIdCounter++, x: cigX, y: safeMinY + Math.random() * (safeMaxY - safeMinY), collected: false }];
          }
        }

        let newlyCollected = 0;
        let newBuzzed = gs.buzzed, newBuzzTimer = gs.buzzTimer;
        newCigs = newCigs.map((c) => {
          if (!c.collected) {
            const dx = BIRD_X - c.x, dy = newBird.y - c.y;
            if (Math.sqrt(dx * dx + dy * dy) < BIRD_R + 14) {
              newlyCollected++;
              newBuzzed = true; newBuzzTimer = stats.buzzDuration;
              earnedCoins += stats.cigCoinBonus * buzzMult * stats.coinMult;
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

        let newSmoke = gs.smokeParticles.map((p) => ({ ...p, x: p.x + p.dx, y: p.y + p.dy, alpha: p.alpha - 0.018, size: p.size + 0.06 })).filter((p) => p.alpha > 0);
        if (newBuzzed && newFrame % 4 === 0) {
          newSmoke = [...newSmoke, {
            x: BIRD_X + 20 + Math.random() * 4, y: newBird.y + (Math.random() - 0.5) * 4,
            dx: 0.4 + Math.random() * 0.6, dy: -0.5 - Math.random() * 0.8,
            alpha: 0.5 + Math.random() * 0.25, size: 3 + Math.random() * 2,
          }];
        }

        // Collision detection
        const bx = BIRD_X, by = newBird.y, r = BIRD_R - 3;
        let crashed = by - r <= 0 || by + r >= CANVAS_H - 36;
        if (!crashed) {
          for (const p of newPipes) {
            if (bx + r > p.x && bx - r < p.x + PW && (by - r < p.topH || by + r > p.topH + stats.pipeGap)) {
              crashed = true; break;
            }
          }
        }

        let shieldCharges = gs.shieldCharges;
        let phase: GameState["phase"] = "playing";
        if (crashed) {
          if (shieldCharges > 0) { shieldCharges--; }
          else { phase = "dead"; }
        }

        const frameCoins = Math.floor(earnedCoins * prestigeMult);
        const totalRunCoins = gs.runCoins + frameCoins;

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

        const nextState: GameState = {
          bird: newBird, pipes: newPipes, cigarettes: newCigs, smokeParticles: newSmoke,
          score: newScore, runCoins: totalRunCoins, frame: newFrame,
          phase, shieldCharges, slowActive, slowTimer,
          buzzed: newBuzzed, buzzTimer: newBuzzTimer,
          cigIdCounter, runCigsSmoked: newRunCigsSmoked,
          runPerks: gs.runPerks, perkChoices: gs.perkChoices,
          nextMilestone: gs.nextMilestone,
          pipeSpawnDist: newPipeSpawnDist,
          countdownTimer: 0,
        };

        if (triggeredMilestone && phase !== "dead") {
          nextState.phase = "choosing";
          nextState.perkChoices = generatePerkChoices(gs.runPerks);
        }

        gameRef.current = nextState;

      } else if (gs.phase === "idle") {
        bgOffRef.current += 0.4;
        gameRef.current = { ...gs, frame: gs.frame + 1, bird: { ...gs.bird, y: CANVAS_H / 2 + Math.sin(gs.frame * 0.05) * 8, angle: 0, vy: 0 } };
      } else {
        // dead
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
  const stats = getStats(saveData.upgrades, gs.runPerks);
  const pLvl = saveData.prestigeLevel || 0;
  const prestigeReq = Math.ceil(100 * Math.pow(2, pLvl));
  const canPrestige = saveData.bestScore >= prestigeReq;

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px", gap: "16px", flexWrap: "wrap" }}>

      {/* Game Canvas */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
        <canvas
          ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          onClick={(e) => handleCanvasInteract(e.clientX, e.clientY)}
          onTouchStart={(e) => { e.preventDefault(); const t = e.touches[0]; if (t) handleCanvasInteract(t.clientX, t.clientY); }}
          style={{ borderRadius: 14, boxShadow: "0 8px 40px rgba(0,0,0,0.7)", cursor: "pointer", touchAction: "none", display: "block" }}
        />
        {stats.slowDuration > 0 && (
          <button
            onClick={activateSlow}
            disabled={gs.phase !== "playing" || gs.slowActive}
            style={{
              background: gs.slowActive ? "#6b21a8" : gs.phase === "playing" ? "#7c3aed" : "#374151",
              color: "white", border: "none", borderRadius: 8, padding: "8px 20px",
              fontSize: 14, fontWeight: "bold", cursor: gs.phase === "playing" && !gs.slowActive ? "pointer" : "default",
              opacity: gs.phase === "playing" && !gs.slowActive ? 1 : 0.5, transition: "all 0.2s",
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
            <div style={{ color: "#9ca3af", fontSize: 11 }}>Roguelike Idle</div>
          </div>
          <div>
            {authLoading ? <div style={{ color: "#4b5563", fontSize: 11 }}>...</div>
              : isAuthenticated && user ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {user.profileImageUrl && <img src={user.profileImageUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />}
                  <button onClick={logout} style={{ background: "transparent", border: "1px solid #374151", color: "#9ca3af", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>Log out</button>
                </div>
              ) : (
                <button onClick={login} style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "white", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>Log in</button>
              )}
          </div>
        </div>

        {/* Coins */}
        <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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

        {/* Active run perks (shown during a run) */}
        {gs.runPerks.length > 0 && (
          <div style={{ background: "#111827", borderRadius: 10, padding: "10px 12px", border: "1px solid #1f2937" }}>
            <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 6 }}>Active Perks This Run</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {gs.runPerks.map((perk) => (
                <div key={perk.id} title={perk.desc} style={{
                  background: RARITY_BG[perk.rarity],
                  border: `1px solid ${RARITY_COLOR[perk.rarity]}`,
                  borderRadius: 6, padding: "2px 7px", fontSize: 12, color: "white",
                }}>
                  {perk.icon} {perk.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", background: "#111827", borderRadius: 8, padding: 3, gap: 3 }}>
          {(["shop", "leaderboard"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, background: activeTab === tab ? "#1e293b" : "transparent",
              color: activeTab === tab ? "#e5e7eb" : "#6b7280",
              border: "none", borderRadius: 6, padding: "6px 0", fontSize: 12,
              fontWeight: activeTab === tab ? "bold" : "normal", cursor: "pointer",
            }}>
              {tab === "shop" ? "🛒 Upgrades" : "🏆 Leaderboard"}
            </button>
          ))}
        </div>

        {/* ─── Shop Tab ────────────────────────────────────────────────── */}
        {activeTab === "shop" && (
          <>
            {/* Stats row */}
            <div style={{ background: "#111827", borderRadius: 10, padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" }}>
              {[
                ["💨", "Speed", stats.pipeSpeed.toFixed(2)],
                ["📐", "Gap", `${stats.pipeGap}px`],
                ["🪙", "Per pipe", `x${stats.coinsPerPipe}`],
                ["🚬", "Buzz bonus", `+${stats.cigCoinBonus}`],
                ["🛡️", "Shield", `${saveData.upgrades.shield} charge${saveData.upgrades.shield !== 1 ? "s" : ""}`],
                ["✨", "Prestige", `x${(1 + pLvl * 0.25).toFixed(2)}`],
              ].map(([icon, label, val]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 12 }}>{icon}</span>
                  <span style={{ color: "#9ca3af", fontSize: 11 }}>{label}:</span>
                  <span style={{ color: label === "Prestige" && pLvl > 0 ? "#f59e0b" : "#e5e7eb", fontSize: 11, fontWeight: "bold" }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Prestige */}
            <div style={{ background: "#110a00", borderRadius: 10, padding: "12px", border: canPrestige ? "1px solid #92400e" : "1px solid #1f2937" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#f59e0b", fontWeight: "bold", fontSize: 13 }}>✨ Prestige{pLvl > 0 && ` Level ${pLvl}`}</span>
                <span style={{ color: "#f59e0b", fontSize: 11 }}>x{(1 + pLvl * 0.25).toFixed(2)} coins</span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
                Reset coins &amp; upgrades for a permanent <strong style={{ color: "#f59e0b" }}>+25% coin bonus</strong>.<br />
                Need best score: <strong style={{ color: canPrestige ? "#a3e635" : "#9ca3af" }}>{prestigeReq}</strong> (yours: <strong style={{ color: canPrestige ? "#a3e635" : "#9ca3af" }}>{saveData.bestScore}</strong>)
              </div>
              <button onClick={handlePrestige} disabled={!canPrestige} style={{
                width: "100%", background: canPrestige ? "linear-gradient(135deg, #d97706, #b45309)" : "#1f2937",
                color: canPrestige ? "white" : "#4b5563", border: "none", borderRadius: 8, padding: "7px 0",
                fontSize: 12, fontWeight: "bold", cursor: canPrestige ? "pointer" : "default",
                boxShadow: canPrestige ? "0 2px 10px rgba(217,119,6,0.4)" : "none", transition: "all 0.2s",
              }}>
                {canPrestige ? `Prestige to Level ${pLvl + 1} ✨` : `Score ${prestigeReq} to unlock`}
              </button>
            </div>

            <div style={{ color: "#9ca3af", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, paddingLeft: 2 }}>Meta Upgrades</div>
            {UPGRADE_DEFS.map(({ key, icon, name, desc }) => {
              const lvl = saveData.upgrades[key];
              const maxed = lvl >= MAX_LEVELS[key];
              const cost = maxed ? 0 : upgradeCost(key, lvl);
              const canAfford = saveData.coins >= cost;
              return (
                <div key={key} style={{ background: "#111827", borderRadius: 10, padding: "10px 12px", border: "1px solid #1f2937", opacity: maxed ? 0.7 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 16 }}>{icon}</span>
                        <span style={{ color: "#e5e7eb", fontWeight: "bold", fontSize: 13 }}>{name}</span>
                        <span style={{ color: lvl > 0 ? "#a3e635" : "#4b5563", fontSize: 11, fontWeight: "bold" }}>Lv{lvl}/{MAX_LEVELS[key]}</span>
                      </div>
                      <div style={{ color: "#6b7280", fontSize: 11, lineHeight: 1.4 }}>{desc(lvl)}</div>
                      <div style={{ marginTop: 6, background: "#1f2937", borderRadius: 4, height: 4, overflow: "hidden" }}>
                        <div style={{ width: `${(lvl / MAX_LEVELS[key]) * 100}%`, height: "100%", background: maxed ? "#22c55e" : "#7c3aed", borderRadius: 4, transition: "width 0.3s" }} />
                      </div>
                    </div>
                    {!maxed ? (
                      <button onClick={() => buyUpgrade(key)} disabled={!canAfford} style={{
                        background: canAfford ? "linear-gradient(135deg, #7c3aed, #6d28d9)" : "#1f2937",
                        color: canAfford ? "white" : "#4b5563",
                        border: "none", borderRadius: 8, padding: "6px 10px",
                        fontSize: 12, fontWeight: "bold", cursor: canAfford ? "pointer" : "default",
                        whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.2s",
                        boxShadow: canAfford ? "0 2px 8px rgba(124,58,237,0.4)" : "none",
                      }}>
                        🪙 {cost.toLocaleString()}
                      </button>
                    ) : (
                      <div style={{ color: "#22c55e", fontSize: 11, fontWeight: "bold", padding: "6px 8px" }}>MAX</div>
                    )}
                  </div>
                </div>
              );
            })}

            <button onClick={() => {
              if (confirm("Reset all progress? This cannot be undone.")) {
                const fresh: SaveData = { coins: 0, upgrades: { tailWind: 0, wideGap: 0, coinBoost: 0, shield: 0, slowTime: 0, chainSmoker: 0 }, bestScore: 0, totalRuns: 0, lifetimeCoins: 0, cigarettesSmoked: 0, prestigeLevel: 0 };
                persistSave(fresh);
                gameRef.current = makeInitialGame(0);
              }
            }} style={{ background: "transparent", border: "1px solid #374151", color: "#4b5563", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer", marginTop: 4 }}>
              Reset Progress
            </button>
          </>
        )}

        {/* ─── Leaderboard Tab ─────────────────────────────────────────── */}
        {activeTab === "leaderboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!isAuthenticated && !authLoading && (
              <div style={{ background: "#111827", borderRadius: 10, padding: "12px", textAlign: "center" }}>
                <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8 }}>Log in to appear on the leaderboard</div>
                <button onClick={login} style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "white", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>Log in</button>
              </div>
            )}
            {leaderboardLoading ? (
              <div style={{ textAlign: "center", color: "#4b5563", padding: "20px 0", fontSize: 13 }}>Loading...</div>
            ) : leaderboard.length === 0 ? (
              <div style={{ textAlign: "center", color: "#4b5563", padding: "20px 0", fontSize: 13 }}>No scores yet. Be the first!</div>
            ) : leaderboard.map((entry) => {
              const isMe = user?.id === entry.userId;
              return (
                <div key={entry.userId} style={{
                  background: isMe ? "#0f172a" : "#111827", borderRadius: 10, padding: "10px 12px",
                  border: isMe ? "1px solid #3b82f6" : "1px solid #1f2937",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <div style={{ color: entry.rank <= 3 ? (["#FFD700","#C0C0C0","#CD7F32"] as const)[entry.rank - 1] : "#4b5563", fontWeight: "bold", fontSize: 14, minWidth: 22, textAlign: "center" }}>
                    {entry.rank <= 3 ? (["🥇","🥈","🥉"] as const)[entry.rank - 1] : `#${entry.rank}`}
                  </div>
                  {entry.profileImageUrl
                    ? <img src={entry.profileImageUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1f2937", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 13 }}>{entry.username.charAt(0).toUpperCase()}</div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: isMe ? "#93c5fd" : "#e5e7eb", fontSize: 12, fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.username}{isMe ? " (you)" : ""}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 10 }}>
                      {entry.totalRuns} runs{entry.prestigeLevel > 0 ? ` • ✨ P${entry.prestigeLevel}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: "#a3e635", fontWeight: "bold", fontSize: 14 }}>{entry.bestScore}</div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>best</div>
                  </div>
                </div>
              );
            })}
            <button onClick={() => {
              setLeaderboardLoading(true);
              fetch("/api/leaderboard").then((r) => r.json()).then((d: { entries?: LeaderboardEntry[] }) => { setLeaderboard(d.entries ?? []); setLeaderboardLoading(false); }).catch(() => setLeaderboardLoading(false));
            }} style={{ background: "transparent", border: "1px solid #374151", color: "#6b7280", borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer" }}>
              ↻ Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

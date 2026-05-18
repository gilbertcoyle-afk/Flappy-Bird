import { useEffect, useRef, useState, useCallback } from "react";

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const BIRD_X = 80;
const BIRD_RADIUS = 18;
const GRAVITY = 0.45;
const FLAP_STRENGTH = -8.5;
const PIPE_WIDTH = 60;
const PIPE_GAP = 155;
const PIPE_SPEED = 2.4;
const PIPE_INTERVAL = 90;

interface Bird {
  y: number;
  vy: number;
  angle: number;
}

interface Pipe {
  x: number;
  topHeight: number;
}

interface GameState {
  bird: Bird;
  pipes: Pipe[];
  score: number;
  frame: number;
  phase: "idle" | "playing" | "dead";
  bestScore: number;
}

function makeInitialState(bestScore = 0): GameState {
  return {
    bird: { y: CANVAS_HEIGHT / 2, vy: 0, angle: 0 },
    pipes: [],
    score: 0,
    frame: 0,
    phase: "idle",
    bestScore,
  };
}

function randomPipeTop(): number {
  const min = 80;
  const max = CANVAS_HEIGHT - PIPE_GAP - 80;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function checkCollision(bird: Bird, pipes: Pipe[]): boolean {
  const bx = BIRD_X;
  const by = bird.y;
  const r = BIRD_RADIUS - 3;

  if (by - r <= 0 || by + r >= CANVAS_HEIGHT - 40) return true;

  for (const pipe of pipes) {
    const px = pipe.x;
    const pw = PIPE_WIDTH;
    const topH = pipe.topHeight;
    const botY = topH + PIPE_GAP;

    if (bx + r > px && bx - r < px + pw) {
      if (by - r < topH || by + r > botY) return true;
    }
  }
  return false;
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
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

function drawScene(ctx: CanvasRenderingContext2D, state: GameState, bgOffset: number) {
  const { bird, pipes, score, phase } = state;

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT - 40);
  skyGrad.addColorStop(0, "#1a1a2e");
  skyGrad.addColorStop(0.5, "#16213e");
  skyGrad.addColorStop(1, "#0f3460");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT - 40);

  // Stars
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  const stars = [
    [30, 40], [80, 20], [140, 60], [200, 15], [260, 45], [320, 30],
    [370, 70], [50, 90], [110, 110], [170, 80], [230, 100], [300, 85],
    [350, 120], [20, 140], [90, 150], [160, 130], [240, 160], [310, 145],
  ];
  stars.forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.arc((sx - bgOffset * 0.1) % CANVAS_WIDTH, sy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Clouds (parallax)
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  const cloudOffX = bgOffset * 0.3;
  [[60, 180, 90, 30], [220, 220, 70, 25], [340, 200, 80, 28]].forEach(([cx, cy, cw, ch]) => {
    const x = ((cx - cloudOffX % CANVAS_WIDTH) + CANVAS_WIDTH) % CANVAS_WIDTH;
    ctx.beginPath();
    ctx.ellipse(x, cy, cw, ch, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Pipes
  pipes.forEach((pipe) => {
    const topH = pipe.topHeight;
    const botY = topH + PIPE_GAP;
    const botH = CANVAS_HEIGHT - 40 - botY;

    // Top pipe
    const pipeGradTop = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0);
    pipeGradTop.addColorStop(0, "#2ecc71");
    pipeGradTop.addColorStop(0.4, "#27ae60");
    pipeGradTop.addColorStop(1, "#1e8449");
    ctx.fillStyle = pipeGradTop;
    drawRoundRect(ctx, pipe.x, 0, PIPE_WIDTH, topH - 12, 4);
    ctx.fill();

    // Top pipe cap
    const capGradT = ctx.createLinearGradient(pipe.x - 5, 0, pipe.x + PIPE_WIDTH + 5, 0);
    capGradT.addColorStop(0, "#27ae60");
    capGradT.addColorStop(0.4, "#2ecc71");
    capGradT.addColorStop(1, "#1e8449");
    ctx.fillStyle = capGradT;
    drawRoundRect(ctx, pipe.x - 5, topH - 24, PIPE_WIDTH + 10, 24, 6);
    ctx.fill();

    // Bottom pipe
    const pipeGradBot = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0);
    pipeGradBot.addColorStop(0, "#2ecc71");
    pipeGradBot.addColorStop(0.4, "#27ae60");
    pipeGradBot.addColorStop(1, "#1e8449");
    ctx.fillStyle = pipeGradBot;
    drawRoundRect(ctx, pipe.x, botY + 12, PIPE_WIDTH, botH, 4);
    ctx.fill();

    // Bottom pipe cap
    ctx.fillStyle = capGradT;
    drawRoundRect(ctx, pipe.x - 5, botY, PIPE_WIDTH + 10, 24, 6);
    ctx.fill();

    // Pipe shine
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(pipe.x + 8, 0, 10, topH - 12);
    ctx.fillRect(pipe.x + 8, botY + 12, 10, botH);
  });

  // Ground
  const groundGrad = ctx.createLinearGradient(0, CANVAS_HEIGHT - 40, 0, CANVAS_HEIGHT);
  groundGrad.addColorStop(0, "#8B6914");
  groundGrad.addColorStop(0.3, "#A0791C");
  groundGrad.addColorStop(1, "#6B4F10");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, CANVAS_HEIGHT - 40, CANVAS_WIDTH, 40);

  // Ground grass strip
  ctx.fillStyle = "#2ecc71";
  ctx.fillRect(0, CANVAS_HEIGHT - 40, CANVAS_WIDTH, 8);

  // Ground lines
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const lx = ((i * 50) - (bgOffset * 2) % 50 + 50) % CANVAS_WIDTH;
    ctx.beginPath();
    ctx.moveTo(lx, CANVAS_HEIGHT - 32);
    ctx.lineTo(lx + 30, CANVAS_HEIGHT);
    ctx.stroke();
  }

  // Bird
  ctx.save();
  ctx.translate(BIRD_X, bird.y);
  ctx.rotate(bird.angle);

  // Bird body shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(3, 4, BIRD_RADIUS, BIRD_RADIUS - 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bird body
  const birdGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, BIRD_RADIUS);
  birdGrad.addColorStop(0, "#FFE066");
  birdGrad.addColorStop(0.6, "#F1C40F");
  birdGrad.addColorStop(1, "#D4AC0D");
  ctx.fillStyle = birdGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, BIRD_RADIUS, BIRD_RADIUS - 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing
  const wingAngle = Math.sin(state.frame * 0.3) * 0.4;
  ctx.save();
  ctx.rotate(wingAngle);
  ctx.fillStyle = "#E67E22";
  ctx.beginPath();
  ctx.ellipse(-4, 4, 10, 5, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Bird eye
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(8, -6, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2c3e50";
  ctx.beginPath();
  ctx.arc(9, -6, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(10, -7, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.fillStyle = "#E67E22";
  ctx.beginPath();
  ctx.moveTo(14, -2);
  ctx.lineTo(22, 0);
  ctx.lineTo(14, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // Score
  if (phase === "playing" || phase === "dead") {
    ctx.fillStyle = "white";
    ctx.font = "bold 40px 'Arial', sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6;
    ctx.fillText(String(score), CANVAS_WIDTH / 2, 70);
    ctx.shadowBlur = 0;
  }

  // Idle screen
  if (phase === "idle") {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    drawRoundRect(ctx, 60, CANVAS_HEIGHT / 2 - 100, CANVAS_WIDTH - 120, 200, 18);
    ctx.fill();

    ctx.fillStyle = "#F1C40F";
    ctx.font = "bold 42px Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    ctx.fillText("FLAPPY BIRD", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);

    ctx.fillStyle = "white";
    ctx.font = "18px Arial";
    ctx.shadowBlur = 4;
    ctx.fillText("Tap, click, or press Space", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10);
    ctx.fillText("to flap your wings!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 36);

    if (state.bestScore > 0) {
      ctx.fillStyle = "#F1C40F";
      ctx.font = "16px Arial";
      ctx.fillText(`Best: ${state.bestScore}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 72);
    }
    ctx.shadowBlur = 0;
  }

  // Dead screen
  if (phase === "dead") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    drawRoundRect(ctx, 50, CANVAS_HEIGHT / 2 - 120, CANVAS_WIDTH - 100, 230, 18);
    ctx.fill();

    ctx.fillStyle = "#E74C3C";
    ctx.font = "bold 38px Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    ctx.fillText("GAME OVER", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 58);

    ctx.fillStyle = "white";
    ctx.font = "22px Arial";
    ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 14);

    ctx.fillStyle = "#F1C40F";
    ctx.font = "18px Arial";
    ctx.fillText(`Best: ${state.bestScore}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 20);

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "16px Arial";
    ctx.fillText("Tap to play again", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
    ctx.shadowBlur = 0;
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(makeInitialState());
  const bgOffsetRef = useRef(0);
  const rafRef = useRef<number>(0);
  const [, forceRender] = useState(0);

  const flap = useCallback(() => {
    const state = stateRef.current;
    if (state.phase === "idle") {
      stateRef.current = {
        ...state,
        phase: "playing",
        bird: { ...state.bird, vy: FLAP_STRENGTH },
      };
    } else if (state.phase === "playing") {
      stateRef.current = {
        ...state,
        bird: { ...state.bird, vy: FLAP_STRENGTH },
      };
    } else if (state.phase === "dead") {
      const best = state.bestScore;
      stateRef.current = makeInitialState(best);
      stateRef.current.phase = "idle";
      forceRender((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " " || e.key === "ArrowUp") {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function loop() {
      const state = stateRef.current;

      if (state.phase === "playing") {
        bgOffsetRef.current += PIPE_SPEED;

        const newVy = state.bird.vy + GRAVITY;
        const newY = state.bird.y + newVy;
        const newAngle = Math.max(-0.5, Math.min(Math.PI / 2.5, newVy * 0.07));
        const newBird: Bird = { y: newY, vy: newVy, angle: newAngle };

        let newPipes = state.pipes.map((p) => ({ ...p, x: p.x - PIPE_SPEED })).filter((p) => p.x + PIPE_WIDTH > -10);

        const newFrame = state.frame + 1;
        if (newFrame % PIPE_INTERVAL === 0) {
          newPipes = [...newPipes, { x: CANVAS_WIDTH + 10, topHeight: randomPipeTop() }];
        }

        let newScore = state.score;
        for (const pipe of newPipes) {
          if (Math.abs(pipe.x + PIPE_WIDTH / 2 - BIRD_X) < PIPE_SPEED + 1) {
            newScore += 1;
          }
        }

        const dead = checkCollision(newBird, newPipes);
        const newBestScore = dead ? Math.max(state.bestScore, newScore) : state.bestScore;

        stateRef.current = {
          ...state,
          bird: newBird,
          pipes: newPipes,
          score: newScore,
          frame: newFrame,
          phase: dead ? "dead" : "playing",
          bestScore: newBestScore,
        };
      } else if (state.phase === "idle") {
        bgOffsetRef.current += 0.5;
        stateRef.current = {
          ...state,
          frame: state.frame + 1,
          bird: {
            ...state.bird,
            y: CANVAS_HEIGHT / 2 + Math.sin(state.frame * 0.05) * 8,
            angle: 0,
            vy: 0,
          },
        };
      } else {
        stateRef.current = {
          ...state,
          frame: state.frame + 1,
        };
      }

      drawScene(ctx!, stateRef.current, bgOffsetRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f0f1a",
        userSelect: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onClick={flap}
        style={{
          display: "block",
          borderRadius: 16,
          boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
          cursor: "pointer",
          touchAction: "none",
          maxWidth: "100vw",
          maxHeight: "100vh",
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          flap();
        }}
      />
    </div>
  );
}

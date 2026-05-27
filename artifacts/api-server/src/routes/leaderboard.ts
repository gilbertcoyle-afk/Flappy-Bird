import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, userProgressTable } from "@workspace/db";
import {
  GetLeaderboardResponse,
  SubmitScoreBody,
  SubmitScoreResponse,
  PerformPrestigeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leaderboard", async (req, res): Promise<void> => {
  const sortBy = req.query.sort === "coins" ? "lifetimeCoins" : "bestScore";

  const rows = await db
    .select()
    .from(userProgressTable)
    .orderBy(desc(userProgressTable[sortBy]))
    .limit(20);

  const entries = rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    username: r.username || "Anonymous",
    profileImageUrl: r.profileImageUrl ?? null,
    bestScore: r.bestScore,
    prestigeLevel: r.prestigeLevel,
    totalRuns: r.totalRuns,
    lifetimeCoins: r.lifetimeCoins,
  }));

  res.json(GetLeaderboardResponse.parse({ entries }));
});

router.post("/scores", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = SubmitScoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { bestScore, totalRuns, cigarettesSmoked, prestigeLevel, lifetimeCoins } = parsed.data;
  const user = req.user;

  const username =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email ||
    "Anonymous";

  const existing = await db
    .select({ bestScore: userProgressTable.bestScore })
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, user.id));

  const currentBest = existing[0]?.bestScore ?? 0;
  const newBestScore = Math.max(currentBest, bestScore);
  const updated = bestScore > currentBest;

  await db
    .insert(userProgressTable)
    .values({
      userId: user.id,
      username,
      profileImageUrl: user.profileImageUrl ?? null,
      bestScore: newBestScore,
      totalRuns,
      cigarettesSmoked,
      prestigeLevel,
      lifetimeCoins,
    })
    .onConflictDoUpdate({
      target: userProgressTable.userId,
      set: {
        username,
        profileImageUrl: user.profileImageUrl ?? null,
        bestScore: newBestScore,
        totalRuns,
        cigarettesSmoked,
        prestigeLevel,
        lifetimeCoins,
        updatedAt: new Date(),
      },
    });

  res.json(SubmitScoreResponse.parse({ bestScore: newBestScore, updated }));
});

router.post("/prestige", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = req.user;

  const existing = await db
    .select()
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, user.id));

  const progress = existing[0];
  if (!progress) {
    res.status(400).json({ error: "No progress found. Play a run first." });
    return;
  }

  const required = Math.ceil(100 * Math.pow(2, progress.prestigeLevel));
  if (progress.bestScore < required) {
    res.status(400).json({ error: `Need a best score of ${required} to prestige` });
    return;
  }

  const newPrestigeLevel = progress.prestigeLevel + 1;

  await db
    .update(userProgressTable)
    .set({ prestigeLevel: newPrestigeLevel, upgrades: {}, updatedAt: new Date() })
    .where(eq(userProgressTable.userId, user.id));

  const multiplier = 1 + 0.25 * newPrestigeLevel;
  res.json(PerformPrestigeResponse.parse({ prestigeLevel: newPrestigeLevel, multiplier }));
});

export default router;

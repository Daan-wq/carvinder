import express from "express";
import { CreditTracker } from "./scrapers/credit-tracker";
import { runScrapeJob } from "./jobs/scrape-job";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const CRON_SECRET = process.env.CRON_SECRET || "";

let lastRunTime: Date | null = null;
let lastRunResult: Record<string, unknown> | null = null;

app.get("/health", async (_req, res) => {
  const creditTracker = new CreditTracker();
  const usage = await creditTracker.getMonthlyUsage();

  res.json({
    status: "ok",
    lastRun: lastRunTime?.toISOString() ?? null,
    lastResult: lastRunResult,
    creditUsage: {
      used: usage.used,
      limit: usage.limit,
      remaining: usage.limit - usage.used,
    },
  });
});

app.post("/run", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  lastRunTime = new Date();
  res.status(202).json({ message: "Scrape job started" });

  void runScrapeJob()
    .then(result => {
      lastRunResult = result;
      console.log("Scrape job completed:", result);
    })
    .catch(error => {
      console.error("Scrape job failed:", error);
      lastRunResult = { error: String(error) };
    });
});

app.listen(PORT, () => {
  console.log(`Worker listening on port ${PORT}`);
});

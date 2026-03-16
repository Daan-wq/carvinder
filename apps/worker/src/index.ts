import express from "express";
import cron from "node-cron";
import { CreditTracker } from "./scrapers/credit-tracker";
import { runScrapeJob } from "./jobs/scrape-job";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const CRON_SECRET = process.env.CRON_SECRET || "";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 */4 * * *";

let lastRunTime: Date | null = null;
let lastRunResult: Record<string, unknown> | null = null;
let isRunning = false;

app.get("/health", async (_req, res) => {
  const creditTracker = new CreditTracker();
  const usage = await creditTracker.getMonthlyUsage();

  res.json({
    status: "ok",
    isRunning,
    lastRun: lastRunTime?.toISOString() ?? null,
    lastResult: lastRunResult,
    creditUsage: {
      used: usage.used,
      limit: usage.limit,
      remaining: usage.limit - usage.used,
    },
  });
});

function startScrape(trigger: string) {
  if (isRunning) {
    console.log(`[${trigger}] Skipping — scrape already in progress`);
    return;
  }

  isRunning = true;
  lastRunTime = new Date();
  console.log(`[${trigger}] Starting scrape job`);

  void runScrapeJob()
    .then(result => {
      lastRunResult = result;
      console.log(`[${trigger}] Scrape completed:`, result);
    })
    .catch(error => {
      console.error(`[${trigger}] Scrape failed:`, error);
      lastRunResult = { error: String(error) };
    })
    .finally(() => {
      isRunning = false;
    });
}

app.post("/run", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (isRunning) {
    res.status(409).json({ message: "Scrape already in progress" });
    return;
  }

  res.status(202).json({ message: "Scrape job started" });
  startScrape("manual");
});

app.listen(PORT, () => {
  console.log(`Worker listening on port ${PORT}`);
  console.log(`Cron schedule: ${CRON_SCHEDULE}`);

  cron.schedule(CRON_SCHEDULE, () => {
    startScrape("cron");
  });
});

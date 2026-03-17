import express from "express";
import cron from "node-cron";
import { prisma, Source } from "@autarb/db";
import { HtmlClient } from "./scrapers/html-client";
import { AutoScoutScraper } from "./scrapers/autoscout";
import { runScrapeJob } from "./jobs/scrape-job";
import { runBulkScoreJob, getBulkScoreStatus } from "./jobs/bulk-score-job";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const CRON_SECRET = process.env.CRON_SECRET || "";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 8,20 * * *"; // 2x/day: 08:00 and 20:00

let lastRunTime: Date | null = null;
let lastRunResult: Record<string, unknown> | null = null;
let isRunning = false;

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    isRunning,
    lastRun: lastRunTime?.toISOString() ?? null,
    lastResult: lastRunResult,
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

// Debug: fetch one AutoScout page and return parsed listings
app.get("/debug-fetch", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const url = (req.query.url as string) || "https://www.autoscout24.nl/lst/volkswagen/golf/?sort=standard&desc=0&ustate=N%2CU&page=1";

  try {
    const client = new HtmlClient();
    const { $, html } = await client.fetchPage(url);

    const fakeSearch = {
      id: "", make: "Volkswagen", model: "Golf", yearMin: null, yearMax: null,
      mileageMax: null, maxPrice: null, alertThresholdPercent: 15,
      sources: [Source.AUTOSCOUT], isActive: true, lastScrapedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any;

    const scraper = new AutoScoutScraper(client);
    const listings = scraper.parseListings($, fakeSearch);

    res.json({
      url,
      htmlLength: html.length,
      htmlSample: html.substring(0, 2000),
      listingsParsed: listings.length,
      listings: listings.slice(0, 5),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

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

app.post("/bulk-score", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { running } = getBulkScoreStatus();
  if (running) {
    res.status(409).json({ message: "Bulk score already in progress", ...getBulkScoreStatus() });
    return;
  }

  res.status(202).json({ message: "Bulk score job started" });
  void runBulkScoreJob().catch(e => console.error("[bulk-score] Fatal error:", e));
});

app.get("/bulk-score/status", (_req, res) => {
  res.json(getBulkScoreStatus());
});

app.listen(PORT, async () => {
  console.log(`Worker listening on port ${PORT}`);
  console.log(`Cron schedule: ${CRON_SCHEDULE}`);

  cron.schedule(CRON_SCHEDULE, () => {
    startScrape("cron");
  });

  await ensureDefaultSearches();
});

async function ensureDefaultSearches() {
  const count = await prisma.watchedSearch.count();
  if (count > 0) return;

  console.log("No watched searches found — seeding defaults");

  const defaults = [
    { make: "BMW", model: "3-serie", sources: [Source.AUTOSCOUT] },
    { make: "Volkswagen", model: "Golf", sources: [Source.AUTOSCOUT] },
    { make: "Audi", model: "A4", sources: [Source.AUTOSCOUT] },
    { make: "Mercedes-Benz", model: "C-klasse", sources: [Source.AUTOSCOUT] },
    { make: "Toyota", model: "Corolla", sources: [Source.AUTOSCOUT] },
  ];

  for (const d of defaults) {
    await prisma.watchedSearch.create({
      data: {
        make: d.make,
        model: d.model,
        sources: d.sources,
        alertThresholdPercent: 15,
        isActive: true,
      },
    });
  }

  console.log(`Seeded ${defaults.length} default watched searches`);
}

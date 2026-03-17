import { prisma, Source, ScrapeJobStatus } from "@autarb/db";
import { sleep } from "../utils/sleep";
import { HtmlClient } from "../scrapers/html-client";
import { AutoScoutScraper } from "../scrapers/autoscout";
import { detectDealsML } from "./ml-deal-detector";
import { enrichListingsWithRDW } from "./rdw-enrichment-job";
import { extractAndStoreNLPFeatures } from "../utils/nlp-extractor";
import { TelegramNotifier } from "../notifications/telegram";
import { formatMLDealMessage } from "../notifications/ml-telegram-formatter";
import { mlClient } from "../ml-client";

function getScraperForSource(source: Source, client: HtmlClient) {
  if (source === Source.AUTOSCOUT) return new AutoScoutScraper(client);
  return null;
}

export async function runScrapeJob(): Promise<{
  totalListings: number;
  newListings: number;
  priceChanges: number;
  deals: number;
}> {
  const htmlClient = new HtmlClient();
  const notifier = new TelegramNotifier();

  let totalListings = 0;
  let newListingsCount = 0;
  let priceChangesCount = 0;

  const changedListingIds = new Set<string>();

  const searches = await prisma.watchedSearch.findMany({
    where: { isActive: true },
  });

  for (const search of searches) {
    for (const source of search.sources) {
      const scraper = getScraperForSource(source, htmlClient);
      if (!scraper) {
        console.warn(`No scraper implemented for source: ${source}`);
        continue;
      }

      const job = await prisma.scrapeJob.create({
        data: { source, status: ScrapeJobStatus.RUNNING },
      });

      const startTime = Date.now();

      try {
        const listings = await scraper.scrape(search);
        totalListings += listings.length;

        let newCount = 0;
        let priceChangeCount = 0;

        for (const listing of listings) {
          const existing = await prisma.carListing.findUnique({
            where: {
              source_externalId: { source, externalId: listing.externalId },
            },
          });

          if (!existing) {
            const created = await prisma.carListing.create({
              data: {
                source,
                externalId: listing.externalId,
                url: listing.url,
                make: listing.make,
                model: listing.model,
                year: listing.year ?? null,
                mileage: listing.mileage ?? null,
                fuelType: listing.fuelType ?? null,
                transmission: listing.transmission ?? null,
                condition: listing.condition ?? null,
                price: listing.price,
                title: listing.title,
                description: listing.description ?? null,
                imageUrls: listing.imageUrls,
                city: listing.city ?? null,
                country: listing.country ?? "NL",
                rawData: listing.rawData as object,
              },
            });

            await prisma.carListingPriceHistory.create({
              data: { listingId: created.id, price: listing.price },
            }).catch(e => console.error(`Price history insert failed:`, e));

            newCount++;
            changedListingIds.add(created.id);
          } else if (existing.price !== listing.price) {
            await prisma.carListingPriceHistory.create({
              data: { listingId: existing.id, price: existing.price },
            }).catch(e => console.error(`Price history insert failed:`, e));

            await prisma.carListing.update({
              where: { id: existing.id },
              data: {
                price: listing.price,
                isPriceChanged: true,
                lastSeenAt: new Date(),
              },
            });

            priceChangeCount++;
            changedListingIds.add(existing.id);
          } else {
            await prisma.carListing.update({
              where: { id: existing.id },
              data: { lastSeenAt: new Date() },
            });
          }
        }

        newListingsCount += newCount;
        priceChangesCount += priceChangeCount;

        await prisma.scrapeJob.update({
          where: { id: job.id },
          data: {
            status: ScrapeJobStatus.DONE,
            listingsFound: listings.length,
            newListings: newCount,
            priceChanges: priceChangeCount,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Scrape failed for ${source}:`, errorMsg);

        await prisma.scrapeJob.update({
          where: { id: job.id },
          data: {
            status: ScrapeJobStatus.FAILED,
            durationMs: Date.now() - startTime,
            errors: [errorMsg],
            completedAt: new Date(),
          },
        });
      }

      await sleep(2000);
    }

    await prisma.watchedSearch.update({
      where: { id: search.id },
      data: { lastScrapedAt: new Date() },
    });
  }

  // --- NLP Feature Extraction ---
  const changedIds = Array.from(changedListingIds);
  if (changedIds.length > 0) {
    console.log(`Extracting NLP features for ${changedIds.length} listings...`);
    for (const listingId of changedIds) {
      try {
        const listing = await prisma.carListing.findUnique({
          where: { id: listingId },
          select: { description: true, title: true, price: true, imageUrls: true },
        });
        if (listing) {
          await extractAndStoreNLPFeatures(
            listingId,
            listing.description,
            listing.title,
            listing.price,
            listing.imageUrls.length,
          );
        }
      } catch (e) {
        console.error(`NLP extraction failed for ${listingId}:`, e);
      }
    }
  }

  // --- RDW Enrichment (for listings with kenteken) ---
  try {
    console.log("Running RDW enrichment for new listings...");
    await enrichListingsWithRDW(changedIds, 50);
  } catch (e) {
    console.error("RDW enrichment failed:", e);
  }

  // --- ML-Powered Deal Detection ---
  let mlDealsCount = 0;
  const mlAvailable = await mlClient.isAvailable();

  if (mlAvailable && changedIds.length > 0) {
    try {
      console.log(`Running ML deal detection for ${changedIds.length} listings...`);
      const mlDeals = await detectDealsML(changedIds);
      mlDealsCount = mlDeals.length;

      if (mlDeals.length > 0) {
        // Send ML-enriched Telegram notifications
        const mlListings = await Promise.all(
          mlDeals.map(async (deal) => {
            const listing = await prisma.carListing.findUnique({
              where: { id: deal.listingId },
              include: { nlpFeatures: true },
            });
            if (!listing) return null;
            return {
              make: listing.make,
              model: listing.model,
              year: listing.year,
              mileage: listing.mileage,
              fuelType: listing.fuelType,
              price: listing.price,
              predictedP50: deal.predictedP50,
              predictedP10: deal.predictedP10,
              predictedP90: deal.predictedP90,
              dealTier: deal.dealTier,
              dealScore: deal.dealScore,
              confidence: deal.confidence,
              city: listing.city,
              source: listing.source,
              url: listing.url,
              hasRedFlags: listing.nlpFeatures?.redFlagCount
                ? listing.nlpFeatures.redFlagCount > 0
                : false,
            };
          })
        );

        const validDeals = mlListings.filter(Boolean) as NonNullable<typeof mlListings[number]>[];
        if (validDeals.length > 0) {
          for (let i = 0; i < validDeals.length; i += 10) {
            const batch = validDeals.slice(i, i + 10);
            const message = formatMLDealMessage(batch);
            await notifier.sendRawMessage(message);
          }
        }
      }
    } catch (e) {
      console.error("ML deal detection failed:", e);
    }
  }

  return {
    totalListings,
    newListings: newListingsCount,
    priceChanges: priceChangesCount,
    deals: mlDealsCount,
  };
}

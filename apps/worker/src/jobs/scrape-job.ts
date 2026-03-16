import { prisma, Source, ScrapeJobStatus } from "@autarb/db";
import { sleep } from "../utils/sleep";
import { CreditTracker } from "../scrapers/credit-tracker";
import { FetchClient } from "../scrapers/fetch-client";
import { getScraperForSource } from "../scrapers/scraper-registry";
import { recalculatePriceProfiles } from "./price-calculator";
import { detectDeals } from "./deal-detector";
import { TelegramNotifier } from "../notifications/telegram";

export async function runScrapeJob(): Promise<{
  totalListings: number;
  newListings: number;
  priceChanges: number;
  deals: number;
}> {
  const creditTracker = new CreditTracker();
  const fetchClient = new FetchClient(creditTracker);
  const notifier = new TelegramNotifier();

  let totalListings = 0;
  let newListingsCount = 0;
  let priceChangesCount = 0;

  const affectedMakeModels = new Map<string, { make: string; model: string }>();
  const changedListingIds = new Set<string>();

  const searches = await prisma.watchedSearch.findMany({
    where: { isActive: true },
  });

  for (const search of searches) {
    for (const source of search.sources) {
      const scraper = getScraperForSource(source, fetchClient);
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
            affectedMakeModels.set(`${created.make}|${created.model}`, {
              make: created.make,
              model: created.model,
            });
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
            affectedMakeModels.set(`${existing.make}|${existing.model}`, {
              make: existing.make,
              model: existing.model,
            });
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

  const affectedKeys = Array.from(affectedMakeModels.values());
  if (affectedKeys.length > 0) {
    await recalculatePriceProfiles(affectedKeys);
  }

  const deals = await detectDeals(Array.from(changedListingIds));

  if (deals.length > 0) {
    deals.sort((a, b) => b.alert.discountPercent - a.alert.discountPercent);

    for (let i = 0; i < deals.length; i += 10) {
      const batch = deals.slice(i, i + 10);
      await notifier.sendDealBatch(
        batch.map(d => ({
          listing: d.listing,
          discountPercent: d.alert.discountPercent,
          discountEuros: d.alert.discountEuros,
          averagePrice: d.alert.averagePrice,
        }))
      );
    }
  }

  return {
    totalListings,
    newListings: newListingsCount,
    priceChanges: priceChangesCount,
    deals: deals.length,
  };
}

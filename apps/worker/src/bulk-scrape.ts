/**
 * Bulk scraper — run locally on your machine to mass-collect NL AutoScout data.
 *
 * Usage:
 *   cd apps/worker
 *   npx tsx src/bulk-scrape.ts
 *
 * Reads DATABASE_URL from ../../.env and writes directly to Railway Postgres.
 * Runs CONCURRENCY searches in parallel. Adjust as needed.
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import { prisma, Source, ScrapeJobStatus, Condition, FuelType } from "@autarb/db";
import { HtmlClient } from "./scrapers/html-client";
import { AutoScoutScraper } from "./scrapers/autoscout";
import { recalculatePriceProfiles } from "./jobs/price-calculator";

const CONCURRENCY = 5; // parallel search requests — safe for a single IP
const DELAY_BETWEEN_BATCHES_MS = 3000;

// All NL makes + their most common models on AutoScout
// Model slugs must match AutoScout NL slugs (lowercase, hyphenated, Dutch)
const NL_MAKES_MODELS: Array<{ make: string; model: string | null }> = [
  // Volkswagen
  { make: "Volkswagen", model: "Golf" },
  { make: "Volkswagen", model: "Polo" },
  { make: "Volkswagen", model: "Tiguan" },
  { make: "Volkswagen", model: "Passat" },
  { make: "Volkswagen", model: "T-Roc" },
  { make: "Volkswagen", model: "ID.3" },
  { make: "Volkswagen", model: "ID.4" },
  { make: "Volkswagen", model: "Transporter" },

  // Toyota
  { make: "Toyota", model: "Yaris" },
  { make: "Toyota", model: "Corolla" },
  { make: "Toyota", model: "C-HR" },
  { make: "Toyota", model: "RAV4" },
  { make: "Toyota", model: "Prius" },
  { make: "Toyota", model: "Aygo" },

  // BMW
  { make: "BMW", model: "1-serie" },
  { make: "BMW", model: "2-serie" },
  { make: "BMW", model: "3-serie" },
  { make: "BMW", model: "4-serie" },
  { make: "BMW", model: "5-serie" },
  { make: "BMW", model: "X1" },
  { make: "BMW", model: "X3" },
  { make: "BMW", model: "X5" },

  // Mercedes-Benz
  { make: "Mercedes-Benz", model: "A-klasse" },
  { make: "Mercedes-Benz", model: "B-klasse" },
  { make: "Mercedes-Benz", model: "C-klasse" },
  { make: "Mercedes-Benz", model: "E-klasse" },
  { make: "Mercedes-Benz", model: "GLA" },
  { make: "Mercedes-Benz", model: "GLC" },
  { make: "Mercedes-Benz", model: "Sprinter" },

  // Audi
  { make: "Audi", model: "A1" },
  { make: "Audi", model: "A3" },
  { make: "Audi", model: "A4" },
  { make: "Audi", model: "A6" },
  { make: "Audi", model: "Q3" },
  { make: "Audi", model: "Q5" },
  { make: "Audi", model: "e-tron" },

  // Skoda
  { make: "Skoda", model: "Octavia" },
  { make: "Skoda", model: "Fabia" },
  { make: "Skoda", model: "Superb" },
  { make: "Skoda", model: "Karoq" },
  { make: "Skoda", model: "Kodiaq" },

  // Peugeot
  { make: "Peugeot", model: "208" },
  { make: "Peugeot", model: "308" },
  { make: "Peugeot", model: "2008" },
  { make: "Peugeot", model: "3008" },
  { make: "Peugeot", model: "5008" },

  // Renault
  { make: "Renault", model: "Clio" },
  { make: "Renault", model: "Megane" },
  { make: "Renault", model: "Captur" },
  { make: "Renault", model: "Kadjar" },
  { make: "Renault", model: "Zoe" },

  // Ford
  { make: "Ford", model: "Fiesta" },
  { make: "Ford", model: "Focus" },
  { make: "Ford", model: "Puma" },
  { make: "Ford", model: "Kuga" },
  { make: "Ford", model: "Mustang Mach-E" },
  { make: "Ford", model: "Transit Custom" },

  // Opel
  { make: "Opel", model: "Astra" },
  { make: "Opel", model: "Corsa" },
  { make: "Opel", model: "Mokka" },
  { make: "Opel", model: "Crossland" },

  // Hyundai
  { make: "Hyundai", model: "i20" },
  { make: "Hyundai", model: "i30" },
  { make: "Hyundai", model: "Tucson" },
  { make: "Hyundai", model: "Kona" },
  { make: "Hyundai", model: "IONIQ 5" },

  // Kia
  { make: "Kia", model: "Picanto" },
  { make: "Kia", model: "Ceed" },
  { make: "Kia", model: "Sportage" },
  { make: "Kia", model: "Niro" },
  { make: "Kia", model: "EV6" },

  // Seat / Cupra
  { make: "SEAT", model: "Ibiza" },
  { make: "SEAT", model: "Leon" },
  { make: "SEAT", model: "Arona" },
  { make: "SEAT", model: "Ateca" },
  { make: "Cupra", model: "Formentor" },
  { make: "Cupra", model: "Born" },

  // Volvo
  { make: "Volvo", model: "XC40" },
  { make: "Volvo", model: "XC60" },
  { make: "Volvo", model: "V60" },
  { make: "Volvo", model: "V90" },

  // Nissan
  { make: "Nissan", model: "Micra" },
  { make: "Nissan", model: "Qashqai" },
  { make: "Nissan", model: "Juke" },
  { make: "Nissan", model: "Leaf" },

  // Fiat
  { make: "Fiat", model: "500" },
  { make: "Fiat", model: "Panda" },
  { make: "Fiat", model: "Tipo" },
  { make: "Fiat", model: "Ducato" },

  // Honda
  { make: "Honda", model: "Jazz" },
  { make: "Honda", model: "HR-V" },
  { make: "Honda", model: "CR-V" },
  { make: "Honda", model: "Civic" },

  // Tesla
  { make: "Tesla", model: "Model 3" },
  { make: "Tesla", model: "Model Y" },
  { make: "Tesla", model: "Model S" },

  // Citroën
  { make: "Citroën", model: "C3" },
  { make: "Citroën", model: "C4" },
  { make: "Citroën", model: "C5 Aircross" },
  { make: "Citroën", model: "Berlingo" },

  // Dacia
  { make: "Dacia", model: "Sandero" },
  { make: "Dacia", model: "Duster" },
  { make: "Dacia", model: "Logan" },
  { make: "Dacia", model: "Spring" },

  // Mazda
  { make: "Mazda", model: "CX-5" },
  { make: "Mazda", model: "CX-30" },
  { make: "Mazda", model: "3" },
  { make: "Mazda", model: "MX-30" },

  // Mini
  { make: "MINI", model: "Cooper" },
  { make: "MINI", model: "Countryman" },
  { make: "MINI", model: "Clubman" },

  // Porsche
  { make: "Porsche", model: "Cayenne" },
  { make: "Porsche", model: "Macan" },
  { make: "Porsche", model: "911" },
  { make: "Porsche", model: "Taycan" },

  // Land Rover / Jaguar
  { make: "Land Rover", model: "Range Rover Evoque" },
  { make: "Land Rover", model: "Discovery Sport" },
];

async function upsertListing(listing: ReturnType<AutoScoutScraper["parseListings"]>[number]) {
  const existing = await prisma.carListing.findUnique({
    where: { source_externalId: { source: Source.AUTOSCOUT, externalId: listing.externalId } },
  });

  if (!existing) {
    const created = await prisma.carListing.create({
      data: {
        source: Source.AUTOSCOUT,
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
        imageUrls: listing.imageUrls,
        city: listing.city ?? null,
        country: listing.country ?? "NL",
        rawData: listing.rawData as object,
      },
    });
    await prisma.carListingPriceHistory.create({
      data: { listingId: created.id, price: listing.price },
    }).catch(() => null);
    return "new";
  } else if (existing.price !== listing.price) {
    await prisma.carListingPriceHistory.create({
      data: { listingId: existing.id, price: existing.price },
    }).catch(() => null);
    await prisma.carListing.update({
      where: { id: existing.id },
      data: { price: listing.price, isPriceChanged: true, lastSeenAt: new Date() },
    });
    return "updated";
  } else {
    await prisma.carListing.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
    return "seen";
  }
}

async function scrapeSearchEntry(
  entry: { make: string; model: string | null },
  client: HtmlClient,
  scraper: AutoScoutScraper,
  stats: { total: number; newCount: number; updated: number; errors: number }
) {
  const search = {
    id: "",
    make: entry.make,
    model: entry.model,
    yearMin: null,
    yearMax: null,
    mileageMax: null,
    maxPrice: null,
    alertThresholdPercent: 15,
    sources: [Source.AUTOSCOUT],
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  try {
    const listings = await scraper.scrape(search);
    stats.total += listings.length;

    for (const listing of listings) {
      const result = await upsertListing(listing);
      if (result === "new") stats.newCount++;
      else if (result === "updated") stats.updated++;
    }

    console.log(`✓ ${entry.make} ${entry.model ?? "(all)"}: ${listings.length} listings`);
  } catch (err) {
    console.error(`✗ ${entry.make} ${entry.model ?? "(all)"}: ${String(err)}`);
    stats.errors++;
  }
}

async function runBulkScrape() {
  console.log(`\n🚗 AutoArb Bulk Scraper — ${NL_MAKES_MODELS.length} make/model combinations\n`);
  console.log(`Concurrency: ${CONCURRENCY} | Delay between batches: ${DELAY_BETWEEN_BATCHES_MS}ms\n`);

  const client = new HtmlClient();
  const scraper = new AutoScoutScraper(client);
  const stats = { total: 0, newCount: 0, updated: 0, errors: 0 };

  // Process in batches of CONCURRENCY
  for (let i = 0; i < NL_MAKES_MODELS.length; i += CONCURRENCY) {
    const batch = NL_MAKES_MODELS.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(NL_MAKES_MODELS.length / CONCURRENCY);

    console.log(`\nBatch ${batchNum}/${totalBatches}: ${batch.map(e => `${e.make} ${e.model ?? ""}`).join(", ")}`);

    await Promise.all(batch.map(entry => scrapeSearchEntry(entry, client, scraper, stats)));

    if (i + CONCURRENCY < NL_MAKES_MODELS.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Recalculate price profiles for all affected make/models
  console.log("\n📊 Recalculating price profiles...");
  const uniqueKeys = NL_MAKES_MODELS.map(e => ({ make: e.make, model: e.model ?? e.make }));
  const profilesUpdated = await recalculatePriceProfiles(uniqueKeys);

  console.log(`\n✅ Bulk scrape complete!`);
  console.log(`   Total listings found : ${stats.total}`);
  console.log(`   New listings saved   : ${stats.newCount}`);
  console.log(`   Price updates        : ${stats.updated}`);
  console.log(`   Errors               : ${stats.errors}`);
  console.log(`   Price profiles built : ${profilesUpdated}`);

  await prisma.$disconnect();
}

runBulkScrape().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

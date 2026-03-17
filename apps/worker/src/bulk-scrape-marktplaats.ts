/**
 * Marktplaats Bulk Scraper — collects NL car listings from Marktplaats.nl
 *
 * Usage:
 *   cd apps/worker && npx tsx src/bulk-scrape-marktplaats.ts
 *
 * Strategy:
 *   Marktplaats limits access to max ~167 pages per make (30 items/page = ~5,000/make).
 *   For 30 makes → ~150,000 accessible listings.
 *
 *   Pagination: /l/auto-s/[make]/p/[page]/
 *   Data: embedded in __NEXT_DATA__ → searchRequestAndResponse.listings
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { prisma, Source, Condition, FuelType, Transmission } from "@autarb/db";
import { HtmlClient } from "./scrapers/html-client";
import { recalculatePriceProfiles } from "./jobs/price-calculator";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONCURRENCY = 4; // HtmlClient serializes HTTP; this overlaps DB writes

// Marktplaats make URL slugs (lowercase, ASCII, hyphenated)
const MP_MAKES: Array<{ display: string; slug: string }> = [
  { display: "Alfa Romeo",    slug: "alfa-romeo" },
  { display: "Audi",          slug: "audi" },
  { display: "BMW",           slug: "bmw" },
  { display: "Citroën",       slug: "citroen" },
  { display: "Cupra",         slug: "cupra" },
  { display: "Dacia",         slug: "dacia" },
  { display: "Fiat",          slug: "fiat" },
  { display: "Ford",          slug: "ford" },
  { display: "Honda",         slug: "honda" },
  { display: "Hyundai",       slug: "hyundai" },
  { display: "Jaguar",        slug: "jaguar" },
  { display: "Jeep",          slug: "jeep" },
  { display: "Kia",           slug: "kia" },
  { display: "Land Rover",    slug: "land-rover" },
  { display: "Mazda",         slug: "mazda" },
  { display: "Mercedes-Benz", slug: "mercedes-benz" },
  { display: "MINI",          slug: "mini" },
  { display: "Mitsubishi",    slug: "mitsubishi" },
  { display: "Nissan",        slug: "nissan" },
  { display: "Opel",          slug: "opel" },
  { display: "Peugeot",       slug: "peugeot" },
  { display: "Porsche",       slug: "porsche" },
  { display: "Renault",       slug: "renault" },
  { display: "SEAT",          slug: "seat" },
  { display: "Skoda",         slug: "skoda" },
  { display: "Suzuki",        slug: "suzuki" },
  { display: "Tesla",         slug: "tesla" },
  { display: "Toyota",        slug: "toyota" },
  { display: "Volkswagen",    slug: "volkswagen" },
  { display: "Volvo",         slug: "volvo" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface MpListing {
  itemId: string;
  title: string;
  priceInfo?: { priceCents?: number; priceType?: string };
  location?: { cityName?: string; countryAbbreviation?: string };
  attributes?: Array<{ key: string; value: string }>;
  pictures?: Array<{ extraExtraLargeUrl?: string; largeUrl?: string; mediumUrl?: string }>;
  vipUrl?: string;
  date?: number; // Unix ms timestamp when listing was first posted
}

interface PageResult {
  listings: MpListing[];
  maxAllowedPageNumber: number;
  totalResultCount: number;
}

interface Stats {
  total: number;
  newCount: number;
  updated: number;
  errors: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUrl(slug: string, page: number): string {
  return page <= 1
    ? `https://www.marktplaats.nl/l/auto-s/${slug}/`
    : `https://www.marktplaats.nl/l/auto-s/${slug}/p/${page}/`;
}

function attr(listing: MpListing, key: string): string | undefined {
  return listing.attributes?.find(a => a.key === key)?.value;
}

function parseFuelType(text: string | undefined): FuelType | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/elektrisch|electric|ev/.test(t)) return FuelType.ELECTRIC;
  if (/hybride?|hybrid/.test(t)) return FuelType.HYBRID;
  if (/diesel/.test(t)) return FuelType.DIESEL;
  if (/lpg|autogas/.test(t)) return FuelType.LPG;
  if (/benzine|petrol/.test(t)) return FuelType.PETROL;
  return undefined;
}

function parseTransmission(text: string | undefined): Transmission | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/automaat|automatic/.test(t)) return Transmission.AUTOMATIC;
  if (/handgeschakeld|manual|schakel/.test(t)) return Transmission.MANUAL;
  return undefined;
}

// ─── Fetch a page ─────────────────────────────────────────────────────────────

async function fetchPage(
  client: HtmlClient,
  slug: string,
  page: number,
  attempt = 0
): Promise<PageResult> {
  const url = buildUrl(slug, page);

  let fetchResult: Awaited<ReturnType<HtmlClient["fetchPage"]>>;
  try {
    fetchResult = await client.fetchPage(url);
  } catch (err: any) {
    const status = err?.response?.status;
    if ((status === 429 || status === 503) && attempt < 4) {
      const wait = [15000, 30000, 60000, 120000][attempt];
      console.warn(`\n[${status}] ${slug} p${page} — retry in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
      return fetchPage(client, slug, page, attempt + 1);
    }
    throw err;
  }

  const { $ } = fetchResult;
  const script = $("#__NEXT_DATA__").html();
  if (!script) return { listings: [], maxAllowedPageNumber: 0, totalResultCount: 0 };

  let nd: any;
  try { nd = JSON.parse(script); } catch { return { listings: [], maxAllowedPageNumber: 0, totalResultCount: 0 }; }

  const sar = nd?.props?.pageProps?.searchRequestAndResponse;
  const listings: MpListing[] = [
    ...(sar?.listings ?? []),
    ...(sar?.topBlock ?? []),
  ].filter(l => l.itemId && l.priceInfo?.priceCents);

  return {
    listings,
    maxAllowedPageNumber: sar?.paginationResponse?.maxAllowedPageNumber
      ?? (JSON.stringify(sar).match(/"maxAllowedPageNumber":(\d+)/)?.[1] ? parseInt(JSON.stringify(sar).match(/"maxAllowedPageNumber":(\d+)/)?.[1]!) : 0),
    totalResultCount: sar?.paginationResponse?.totalResultCount
      ?? (JSON.stringify(sar).match(/"totalResultCount":(\d+)/)?.[1] ? parseInt(JSON.stringify(sar).match(/"totalResultCount":(\d+)/)?.[1]!) : 0),
  };
}

// ─── Scrape all pages for one make ───────────────────────────────────────────

async function scrapeMake(
  client: HtmlClient,
  make: { display: string; slug: string },
  stats: Stats,
  affectedKeys: Map<string, { make: string; model: string }>
): Promise<void> {
  try {
    const first = await fetchPage(client, make.slug, 1);

    if (first.totalResultCount === 0) {
      process.stdout.write("·");
      return;
    }

    const maxPage = first.maxAllowedPageNumber || 1;
    console.log(`\n▶ ${make.display}: ${first.totalResultCount} total, ${maxPage} pages accessible`);

    // Collect page 1 listings then remaining pages
    const allListings = [...first.listings];
    for (let page = 2; page <= maxPage; page++) {
      const result = await fetchPage(client, make.slug, page);
      allListings.push(...result.listings);
      if (page % 20 === 0) {
        process.stdout.write(`  [${make.display} p${page}/${maxPage}]`);
      }
    }

    // Upsert to DB
    for (const raw of allListings) {
      await upsertListing(raw, make.display, stats);
      const model = attr(raw, "model") ?? "Unknown";
      affectedKeys.set(`${make.display}|${model}`, { make: make.display, model });
    }

    console.log(`\n✓ ${make.display}: saved ${allListings.length} / ${first.totalResultCount}`);
  } catch (err) {
    console.error(`\n✗ ${make.display}: ${String(err)}`);
    stats.errors++;
  }
}

// ─── DB upsert ────────────────────────────────────────────────────────────────

async function upsertListing(raw: MpListing, makeName: string, stats: Stats) {
  const externalId = raw.itemId;
  const priceCents = raw.priceInfo?.priceCents;
  if (!priceCents || priceCents <= 0) return;
  const price = Math.round(priceCents / 100);
  if (price < 500 || price > 500000) return;

  const model = attr(raw, "model") ?? "Unknown";
  const yearStr = attr(raw, "constructionYear");
  const year = yearStr ? parseInt(yearStr, 10) : undefined;
  const mileageStr = attr(raw, "mileage");
  const mileage = mileageStr ? parseInt(mileageStr, 10) : undefined;
  const fuelType = parseFuelType(attr(raw, "fuel"));
  const transmission = parseTransmission(attr(raw, "transmission"));

  const vipUrl = raw.vipUrl
    ? `https://www.marktplaats.nl${raw.vipUrl}`
    : `https://www.marktplaats.nl/v/auto-s/${externalId}`;

  const imageUrls = (raw.pictures ?? [])
    .map(p => p.extraExtraLargeUrl ?? p.largeUrl ?? p.mediumUrl)
    .filter(Boolean) as string[];

  const listedAt = raw.date ? new Date(raw.date) : null;

  try {
    const existing = await prisma.carListing.findUnique({
      where: { source_externalId: { source: Source.MARKTPLAATS, externalId } },
    });

    if (!existing) {
      const created = await prisma.carListing.create({
        data: {
          source: Source.MARKTPLAATS,
          externalId,
          url: vipUrl,
          make: makeName,
          model,
          year: year ?? null,
          mileage: mileage ?? null,
          fuelType: fuelType ?? null,
          transmission: transmission ?? null,
          condition: Condition.USED_GOOD,
          price,
          title: raw.title,
          imageUrls,
          city: raw.location?.cityName ?? null,
          country: raw.location?.countryAbbreviation ?? "NL",
          rawData: { source: "marktplaats" },
          listedAt,
        },
      });
      await prisma.carListingPriceHistory
        .create({ data: { listingId: created.id, price } })
        .catch(() => null);
      stats.newCount++;
    } else if (existing.price !== price) {
      await prisma.carListingPriceHistory
        .create({ data: { listingId: existing.id, price: existing.price } })
        .catch(() => null);
      await prisma.carListing.update({
        where: { id: existing.id },
        data: { price, isPriceChanged: true, lastSeenAt: new Date() },
      });
      stats.updated++;
    } else {
      await prisma.carListing.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
    }
    stats.total++;
  } catch (err: any) {
    if (err?.code !== "P2002") throw err;
  }
}

// ─── Worker queue ─────────────────────────────────────────────────────────────

async function processQueue<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) await fn(queue.shift()!);
    })
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runMarktplaatsScrape() {
  const startTime = Date.now();
  console.log(`\n🏪  Marktplaats Bulk Scraper`);
  console.log(`Makes: ${MP_MAKES.length} | Max ~5,000/make | Concurrency: ${CONCURRENCY}`);
  console.log(`HTTP: serialized, ~3s/request\n`);

  const client = new HtmlClient();
  const stats: Stats = { total: 0, newCount: 0, updated: 0, errors: 0 };
  const affectedKeys = new Map<string, { make: string; model: string }>();

  await processQueue(MP_MAKES, CONCURRENCY, async make => {
    await scrapeMake(client, make, stats, affectedKeys);
  });

  // Price profiles
  const keys = Array.from(affectedKeys.values());
  if (keys.length > 0) {
    console.log(`\n\n📊 Recalculating price profiles for ${keys.length} make/model combos...`);
    const n = await recalculatePriceProfiles(keys);
    console.log(`   Profiles built: ${n}`);
  }

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n✅ Done in ${totalMin} min`);
  console.log(`   Total processed : ${stats.total}`);
  console.log(`   New listings    : ${stats.newCount}`);
  console.log(`   Price updates   : ${stats.updated}`);
  console.log(`   Errors          : ${stats.errors}`);

  await prisma.$disconnect();
}

runMarktplaatsScrape().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

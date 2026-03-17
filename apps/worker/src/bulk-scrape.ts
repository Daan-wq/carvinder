/**
 * Adaptive Bulk Scraper — collects all AutoScout NL listings (~180–250k).
 *
 * Usage:
 *   cd apps/worker && npx tsx src/bulk-scrape.ts
 *
 * Strategy:
 *   Phase 1 — make × year (30 makes × 36 years = 1,080 segments, ~3s/request sequential)
 *     Reads numberOfPages from __NEXT_DATA__ on page 1.
 *     < 20 pages → scrape all pages directly.
 *     = 20 pages → OVERFLOW: queue 20 finer price-band sub-segments.
 *
 *   Phase 2 — overflow × price_band (max ~300 overflows × 20 bands = 6,000 extra segments)
 *     Same logic. Finer bands ensure each sub-segment stays <400 results.
 *
 *   Total estimated run time: ~6 hours (sequential HTTP at ~3s/request).
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { prisma, Source, Condition, FuelType, Transmission } from "@autarb/db";
import { HtmlClient } from "./scrapers/html-client";
import { recalculatePriceProfiles } from "./jobs/price-calculator";

// ─── Config ──────────────────────────────────────────────────────────────────

// HtmlClient serializes all HTTP (one at a time, 2.5–4.5 s between requests).
// CONCURRENCY here only affects how many segments can overlap their DB writes.
const CONCURRENCY = 6;
const MAX_PAGES = 20;

const ALL_NL_MAKES = [
  "Alfa Romeo", "Audi", "BMW", "Citroën", "Cupra",
  "Dacia", "Fiat", "Ford", "Honda", "Hyundai",
  "Jaguar", "Jeep", "Kia", "Land Rover", "Mazda",
  "Mercedes-Benz", "MINI", "Mitsubishi", "Nissan", "Opel",
  "Peugeot", "Porsche", "Renault", "SEAT", "Skoda",
  "Suzuki", "Tesla", "Toyota", "Volkswagen", "Volvo",
];

const YEARS = Array.from({ length: 36 }, (_, i) => 1990 + i); // 1990–2025

// 20 price bands — fine enough that even VW peak years stay under 400/band
const PRICE_BANDS: Array<{ min: number | null; max: number | null }> = [
  { min: null,  max: 3000  },
  { min: 3000,  max: 5000  },
  { min: 5000,  max: 7000  },
  { min: 7000,  max: 9000  },
  { min: 9000,  max: 11000 },
  { min: 11000, max: 13000 },
  { min: 13000, max: 15000 },
  { min: 15000, max: 17000 },
  { min: 17000, max: 19000 },
  { min: 19000, max: 21000 },
  { min: 21000, max: 23000 },
  { min: 23000, max: 26000 },
  { min: 26000, max: 29000 },
  { min: 29000, max: 33000 },
  { min: 33000, max: 38000 },
  { min: 38000, max: 45000 },
  { min: 45000, max: 55000 },
  { min: 55000, max: 70000 },
  { min: 70000, max: 100000 },
  { min: 100000, max: null },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Segment {
  make: string;
  year: number;
  priceFrom?: number | null;
  priceTo?: number | null;
}

interface ParsedListing {
  externalId: string;
  url: string;
  make: string;
  model: string;
  title: string;
  price: number;
  year?: number;
  mileage?: number;
  fuelType?: FuelType;
  transmission?: Transmission;
  imageUrls: string[];
  city?: string;
  country: string;
  rawData: object;
  listedAt?: Date;
}

interface PageResult {
  listings: ParsedListing[];
  numberOfPages: number;
  numberOfResults: number;
}

interface Stats {
  total: number;
  newCount: number;
  updated: number;
  errors: number;
  overflows: number;
}

// ─── URL builder ─────────────────────────────────────────────────────────────

function toMakeSlug(make: string): string {
  return make
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Citroën → citroen
    .replace(/\s+/g, "-");
}

function buildUrl(seg: Segment, page: number): string {
  // Build manually — URLSearchParams encodes "N,U" → "N%2CU" which AutoScout ignores,
  // causing all year/price filters to be silently dropped.
  const parts = [
    `sort=standard`,
    `desc=0`,
    `ustate=N,U`,   // must stay unencoded — AutoScout NL requires literal comma
    `cy=NL`,
    `atype=C`,
    `page=${page}`,
    `fregfrom=${seg.year}`,
    `fregto=${seg.year}`,
  ];
  if (seg.priceFrom != null) parts.push(`pricefrom=${seg.priceFrom}`);
  if (seg.priceTo != null) parts.push(`priceto=${seg.priceTo}`);

  return `https://www.autoscout24.nl/lst/${toMakeSlug(seg.make)}/?${parts.join("&")}`;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parsePrice(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/\./g, "").match(/(\d{3,7})/);
  if (!m) return null;
  const p = parseInt(m[1], 10);
  return p >= 500 && p <= 500000 ? p : null;
}

function parseMileage(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.replace(/\./g, "").match(/(\d{1,6})\s*km/i);
  if (!m) return undefined;
  const km = parseInt(m[1], 10);
  return km > 0 && km < 2000000 ? km : undefined;
}

function parseYear(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const s = text.match(/\d{2}\/(\d{4})/);
  if (s) return parseInt(s[1], 10);
  const y = text.match(/\b(19[89]\d|20[012]\d)\b/);
  return y ? parseInt(y[1], 10) : undefined;
}

function parseFuelType(text: string | undefined): FuelType | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/elektrisch|electric|\bev\b/.test(t)) return FuelType.ELECTRIC;
  if (/hybride?|hybrid/.test(t)) return FuelType.HYBRID;
  if (/diesel/.test(t)) return FuelType.DIESEL;
  if (/lpg|autogas/.test(t)) return FuelType.LPG;
  if (/benzine|petrol|benzin/.test(t)) return FuelType.PETROL;
  return undefined;
}

function parseTransmission(text: string | undefined): Transmission | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/automaat|automatic|dsg/.test(t)) return Transmission.AUTOMATIC;
  if (/handgeschakeld|manual|schakel/.test(t)) return Transmission.MANUAL;
  return undefined;
}

// ─── Fetch one page ───────────────────────────────────────────────────────────

async function fetchPage(
  client: HtmlClient,
  seg: Segment,
  page: number,
  attempt = 0
): Promise<PageResult> {
  const url = buildUrl(seg, page);

  let fetchResult: Awaited<ReturnType<HtmlClient["fetchPage"]>>;
  try {
    fetchResult = await client.fetchPage(url);
  } catch (err: any) {
    const status = err?.response?.status;
    if ((status === 429 || status === 503) && attempt < 4) {
      const wait = [15000, 30000, 60000, 120000][attempt];
      console.warn(`\n[${status}] ${seg.make} ${seg.year} p${page} — retry in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
      return fetchPage(client, seg, page, attempt + 1);
    }
    throw err;
  }

  const { $ } = fetchResult;
  const nextDataScript = $("#__NEXT_DATA__").html();
  if (!nextDataScript) return { listings: [], numberOfPages: 0, numberOfResults: 0 };

  let nextData: any;
  try { nextData = JSON.parse(nextDataScript); } catch { return { listings: [], numberOfPages: 0, numberOfResults: 0 }; }

  const pageProps = nextData?.props?.pageProps ?? {};
  const numberOfPages: number = pageProps.numberOfPages ?? 0;
  const numberOfResults: number = pageProps.numberOfResults ?? 0;
  const rawListings: any[] = pageProps.listings ?? [];

  const seen = new Set<string>();
  const listings: ParsedListing[] = [];

  for (const raw of rawListings) {
    try {
      const externalId: string = raw.id;
      if (!externalId || seen.has(externalId)) continue;
      seen.add(externalId);

      const listingUrl: string = raw.url?.startsWith("http")
        ? raw.url
        : `https://www.autoscout24.nl${raw.url}`;

      const price = parsePrice(raw.price?.priceFormatted);
      if (!price) continue;

      const detail = (icon: string): string =>
        (raw.vehicleDetails as any[] | undefined)?.find((d: any) => d.iconName === icon)?.data ?? "";

      const powerMatch = detail("speedometer").match(/(\d+)\s*kW/i);

      // AutoScout exposes listing date as firstOnlineDate (ISO string) on the listing object
      const rawListedAt = raw.firstOnlineDate ?? raw.listedAt ?? raw.onlineDate ?? null;
      const listedAt = rawListedAt ? new Date(rawListedAt) : undefined;

      listings.push({
        externalId,
        url: listingUrl,
        make: seg.make,
        model: raw.vehicle?.model ?? "Unknown",
        title: [raw.vehicle?.make, raw.vehicle?.model, raw.vehicle?.modelVersionInput].filter(Boolean).join(" "),
        price,
        year: parseYear(detail("calendar")),
        mileage: parseMileage(raw.vehicle?.mileageInKm ?? detail("mileage_odometer")),
        fuelType: parseFuelType(raw.vehicle?.fuel ?? detail("gas_pump")),
        transmission: parseTransmission(raw.vehicle?.transmission ?? detail("gearbox")),
        imageUrls: Array.isArray(raw.images) ? raw.images : [],
        city: raw.location?.city ?? undefined,
        country: raw.location?.countryCode ?? "NL",
        rawData: { source: "autoscout24", powerKw: powerMatch ? parseInt(powerMatch[1], 10) : undefined },
        listedAt,
      });
    } catch { /* skip malformed */ }
  }

  return { listings, numberOfPages, numberOfResults };
}

// ─── Scrape full segment (all pages) ─────────────────────────────────────────

async function scrapeSegment(
  client: HtmlClient,
  seg: Segment,
  stats: Stats,
  affectedKeys: Map<string, { make: string; model: string }>
): Promise<boolean /* isOverflow */> {
  const label = `${seg.make} ${seg.year}` +
    (seg.priceFrom != null ? ` €${seg.priceFrom ?? 0}–${seg.priceTo ?? "∞"}` : "");

  try {
    const first = await fetchPage(client, seg, 1);

    if (first.numberOfResults === 0) {
      process.stdout.write("·");
      return false;
    }

    const isOverflow = first.numberOfPages >= MAX_PAGES;
    const allListings = [...first.listings];

    for (let page = 2; page <= Math.min(first.numberOfPages, MAX_PAGES); page++) {
      const result = await fetchPage(client, seg, page);
      allListings.push(...result.listings);
    }

    for (const listing of allListings) {
      await upsertListing(listing, stats);
      affectedKeys.set(`${listing.make}|${listing.model}`, { make: listing.make, model: listing.model });
    }

    console.log(
      `\n✓ ${label}: ${allListings.length}/${first.numberOfResults}` +
      (isOverflow ? "  ⚠️  splitting by price" : "")
    );

    return isOverflow;
  } catch (err) {
    console.error(`\n✗ ${label}: ${String(err)}`);
    stats.errors++;
    return false;
  }
}

// ─── DB upsert ────────────────────────────────────────────────────────────────

async function upsertListing(listing: ParsedListing, stats: Stats) {
  try {
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
          condition: Condition.USED_GOOD,
          price: listing.price,
          title: listing.title,
          imageUrls: listing.imageUrls,
          city: listing.city ?? null,
          country: listing.country,
          rawData: listing.rawData,
          listedAt: listing.listedAt ?? null,
        },
      });
      await prisma.carListingPriceHistory
        .create({ data: { listingId: created.id, price: listing.price } })
        .catch(() => null);
      stats.newCount++;
    } else if (existing.price !== listing.price) {
      await prisma.carListingPriceHistory
        .create({ data: { listingId: existing.id, price: existing.price } })
        .catch(() => null);
      await prisma.carListing.update({
        where: { id: existing.id },
        data: { price: listing.price, isPriceChanged: true, lastSeenAt: new Date() },
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
    if (err?.code !== "P2002") throw err; // ignore race-condition duplicates
  }
}

// ─── Worker-pool queue ────────────────────────────────────────────────────────

async function processQueue<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        await fn(queue.shift()!);
      }
    })
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runBulkScrape() {
  const startTime = Date.now();
  console.log(`\n🚗  AutoArb Adaptive Bulk Scraper`);
  console.log(`Makes: ${ALL_NL_MAKES.length} | Years: 1990–2025 | Concurrency: ${CONCURRENCY}`);
  console.log(`HTTP: serialized, ~3s/request | Price bands: ${PRICE_BANDS.length} (overflow splits)\n`);

  const client = new HtmlClient();
  const stats: Stats = { total: 0, newCount: 0, updated: 0, errors: 0, overflows: 0 };
  const affectedKeys = new Map<string, { make: string; model: string }>();

  // ── Phase 1: make × year ───────────────────────────────────────────────────
  const phase1: Segment[] = ALL_NL_MAKES.flatMap(make => YEARS.map(year => ({ make, year })));
  console.log(`Phase 1: ${phase1.length} segments (${ALL_NL_MAKES.length} makes × ${YEARS.length} years)\n`);

  const overflowQueue: Segment[] = [];
  let p1done = 0;

  await processQueue(phase1, CONCURRENCY, async seg => {
    const isOverflow = await scrapeSegment(client, seg, stats, affectedKeys);
    if (isOverflow) {
      for (const band of PRICE_BANDS) {
        overflowQueue.push({ make: seg.make, year: seg.year, priceFrom: band.min, priceTo: band.max });
      }
      stats.overflows++;
    }
    p1done++;
    if (p1done % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      const rate = p1done / ((Date.now() - startTime) / 1000);
      const eta = ((phase1.length - p1done) / rate / 60).toFixed(0);
      console.log(`\n[Phase 1] ${p1done}/${phase1.length} | ${elapsed}min | ETA ~${eta}min | new: ${stats.newCount} | overflows: ${stats.overflows}\n`);
    }
  });

  // ── Phase 2: overflow × price band ────────────────────────────────────────
  if (overflowQueue.length > 0) {
    console.log(`\n\nPhase 2: ${overflowQueue.length} overflow segments\n`);
    let p2done = 0;
    await processQueue(overflowQueue, CONCURRENCY, async seg => {
      await scrapeSegment(client, seg, stats, affectedKeys);
      p2done++;
      if (p2done % 100 === 0) {
        console.log(`\n[Phase 2] ${p2done}/${overflowQueue.length} | new: ${stats.newCount}\n`);
      }
    });
  }

  // ── Price profiles ─────────────────────────────────────────────────────────
  const keys = Array.from(affectedKeys.values());
  if (keys.length > 0) {
    console.log(`\n\n📊 Recalculating price profiles for ${keys.length} make/model combos...`);
    const profilesUpdated = await recalculatePriceProfiles(keys);
    console.log(`   Profiles built: ${profilesUpdated}`);
  }

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n✅ Done in ${totalMin} min`);
  console.log(`   Total processed : ${stats.total}`);
  console.log(`   New listings    : ${stats.newCount}`);
  console.log(`   Price updates   : ${stats.updated}`);
  console.log(`   Errors          : ${stats.errors}`);

  await prisma.$disconnect();
}

runBulkScrape().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

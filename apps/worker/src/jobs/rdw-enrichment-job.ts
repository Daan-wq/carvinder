import { prisma } from "@autarb/db";

const RDW_VEHICLES_URL = "https://opendata.rdw.nl/resource/m9d7-ebf2.json";
const RDW_FUEL_URL = "https://opendata.rdw.nl/resource/8ys7-d773.json";
const RDW_RATE_LIMIT_MS = 1000; // 1 request per second (conservative)

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface RDWVehicleData {
  kenteken: string;
  merk: string | null;
  handelsbenaming: string | null;
  catalogusprijs: number | null;
  gewicht: number | null;
  cilinderinhoud: number | null;
  vermogenKw: number | null;
  co2Uitstoot: number | null;
  euroKlasse: string | null;
  energielabel: string | null;
  brandstof: string | null;
  apkVervaldatum: Date | null;
  eersteKleur: string | null;
  eersteToelating: Date | null;
  eersteTenaamstellingNl: Date | null;
  isGeexporteerd: boolean;
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  try {
    const str = value.trim();
    if (str.length === 8) {
      // YYYYMMDD format
      const year = parseInt(str.slice(0, 4), 10);
      const month = parseInt(str.slice(4, 6), 10) - 1;
      const day = parseInt(str.slice(6, 8), 10);
      return new Date(year, month, day);
    }
    return null;
  } catch {
    return null;
  }
}

function parseIntSafe(value: string | undefined | null): number | null {
  if (!value) return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

async function lookupRDW(kenteken: string): Promise<RDWVehicleData | null> {
  const normalized = kenteken.toUpperCase().replace(/-/g, "").trim();
  if (!normalized || normalized.length < 4 || normalized.length > 8)
    return null;

  try {
    // Fetch vehicle data
    const vehicleResp = await fetch(`${RDW_VEHICLES_URL}?kenteken=${normalized}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!vehicleResp.ok) return null;

    const vehicles = (await vehicleResp.json()) as Record<string, string>[];
    if (!vehicles.length) return null;
    const v = vehicles[0];

    await sleep(RDW_RATE_LIMIT_MS);

    // Fetch fuel data
    let brandstof: string | null = null;
    let emissieklasse: string | null = null;
    try {
      const fuelResp = await fetch(`${RDW_FUEL_URL}?kenteken=${normalized}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (fuelResp.ok) {
        const fuels = (await fuelResp.json()) as Record<string, string>[];
        if (fuels.length) {
          brandstof = fuels[0].brandstof_omschrijving || null;
          emissieklasse = fuels[0].emissieklasse_eg_goedkeuring_zwaar || null;
        }
      }
    } catch {
      // Fuel lookup failure is non-critical
    }

    return {
      kenteken: normalized,
      merk: v.merk || null,
      handelsbenaming: v.handelsbenaming || null,
      catalogusprijs: parseIntSafe(v.catalogusprijs),
      gewicht: parseIntSafe(v.massa_ledig_voertuig),
      cilinderinhoud: parseIntSafe(v.cilinderinhoud),
      vermogenKw: parseIntSafe(v.vermogen_massarijklaar),
      co2Uitstoot: parseIntSafe(v.co2_uitstoot_gecombineerd),
      euroKlasse: emissieklasse,
      energielabel: v.zuinigheidslabel || null,
      brandstof,
      apkVervaldatum: parseDate(v.vervaldatum_apk),
      eersteKleur: v.eerste_kleur || null,
      eersteToelating: parseDate(v.datum_eerste_toelating),
      eersteTenaamstellingNl: parseDate(v.datum_eerste_tenaamstelling_in_nederland),
      isGeexporteerd: v.export_indicator === "Ja",
    };
  } catch (error) {
    console.error(`RDW lookup failed for ${normalized}:`, error);
    return null;
  }
}

export async function enrichListingsWithRDW(
  listingIds?: string[],
  maxListings: number = 50
): Promise<{ enriched: number; failed: number }> {
  // Find listings with kenteken but no RDW data yet
  const where = listingIds
    ? { id: { in: listingIds }, kenteken: { not: null } }
    : { kenteken: { not: null } };

  const listings = await prisma.carListing.findMany({
    where: {
      ...where,
      taxData: null, // not yet enriched
      isActive: true,
    },
    select: { id: true, kenteken: true },
    take: maxListings,
    orderBy: { createdAt: "desc" },
  });

  let enriched = 0;
  let failed = 0;

  for (const listing of listings) {
    if (!listing.kenteken) continue;

    // Check if we already have cached RDW data
    let rdwRecord = await prisma.rDWVehicleData.findUnique({
      where: {
        kenteken: listing.kenteken.toUpperCase().replace(/-/g, ""),
      },
    });

    if (!rdwRecord) {
      const data = await lookupRDW(listing.kenteken);
      if (!data) {
        failed++;
        await sleep(RDW_RATE_LIMIT_MS);
        continue;
      }

      rdwRecord = await prisma.rDWVehicleData.upsert({
        where: { kenteken: data.kenteken },
        create: {
          kenteken: data.kenteken,
          merk: data.merk,
          handelsbenaming: data.handelsbenaming,
          catalogusprijs: data.catalogusprijs,
          gewicht: data.gewicht,
          cilinderinhoud: data.cilinderinhoud,
          vermogenKw: data.vermogenKw,
          co2Uitstoot: data.co2Uitstoot,
          euroKlasse: data.euroKlasse,
          energielabel: data.energielabel,
          brandstof: data.brandstof,
          apkVervaldatum: data.apkVervaldatum,
          eersteKleur: data.eersteKleur,
          eersteToelating: data.eersteToelating,
          eersteTenaamstellingNl: data.eersteTenaamstellingNl,
          isGeexporteerd: data.isGeexporteerd,
        },
        update: {
          catalogusprijs: data.catalogusprijs,
          gewicht: data.gewicht,
          co2Uitstoot: data.co2Uitstoot,
          apkVervaldatum: data.apkVervaldatum,
          isGeexporteerd: data.isGeexporteerd,
          lastLookupAt: new Date(),
        },
      });

      await sleep(RDW_RATE_LIMIT_MS);
    }

    // Create tax data record linking listing to RDW data
    await prisma.listingTaxData.upsert({
      where: { listingId: listing.id },
      create: {
        listingId: listing.id,
        rdwDataId: rdwRecord.id,
      },
      update: {
        rdwDataId: rdwRecord.id,
      },
    });

    enriched++;
  }

  console.log(
    `RDW enrichment: ${enriched} enriched, ${failed} failed out of ${listings.length}`
  );
  return { enriched, failed };
}

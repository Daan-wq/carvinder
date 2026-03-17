import { Condition, FuelType, Source, Transmission, type WatchedSearch } from "@autarb/db";
import type { CheerioAPI } from "cheerio";
import { HtmlClient } from "./html-client";
import type { ScrapedListing } from "./base-scraper";

interface NextDataListing {
  id: string;
  url: string;
  price: { priceFormatted: string };
  vehicle: {
    make: string;
    model: string;
    modelVersionInput?: string;
    offerType?: string;
    transmission?: string;
    fuel?: string;
    mileageInKm?: string;
  };
  vehicleDetails?: Array<{ data: string; iconName: string; ariaLabel: string }>;
  location?: { countryCode?: string; city?: string };
  images?: string[];
}

export class AutoScoutScraper {
  readonly source = Source.AUTOSCOUT;

  private readonly maxListingsPerRun = 100;
  private readonly maxPagesPerSearch = 5;

  constructor(private client: HtmlClient) {}

  buildSearchUrl(search: WatchedSearch, page: number): string {
    // Build manually — URLSearchParams encodes "N,U" → "N%2CU" which AutoScout ignores
    const parts = [
      `sort=standard`,
      `desc=0`,
      `ustate=N,U`,
      `cy=NL`,
      `atype=C`,
      `page=${page}`,
    ];
    if (search.yearMin) parts.push(`fregfrom=${search.yearMin}`);
    if (search.yearMax) parts.push(`fregto=${search.yearMax}`);
    if (search.mileageMax) parts.push(`kmTo=${search.mileageMax}`);
    if (search.maxPrice) parts.push(`priceto=${search.maxPrice}`);

    const make = this.toSlug(search.make);
    const model = search.model ? this.toSlug(search.model) : "";
    const path = model ? `${make}/${model}` : make;

    return `https://www.autoscout24.nl/lst/${path}/?${parts.join("&")}`;
  }

  async scrape(search: WatchedSearch): Promise<ScrapedListing[]> {
    const listings: ScrapedListing[] = [];

    for (let page = 1; page <= this.maxPagesPerSearch; page++) {
      if (listings.length >= this.maxListingsPerRun) break;

      const url = this.buildSearchUrl(search, page);

      try {
        const { $ } = await this.client.fetchPage(url);
        const pageListings = this.parseListings($, search);

        console.log(`[AutoScout] ${search.make} ${search.model ?? ""} page ${page}: ${pageListings.length} listings`);

        if (pageListings.length === 0) break;

        for (const l of pageListings) {
          if (listings.length >= this.maxListingsPerRun) break;
          listings.push(l);
        }
      } catch (error) {
        console.error(`[AutoScout] Error on page ${page} for ${search.make}:`, error);
        break;
      }
    }

    return listings;
  }

  parseListings($: CheerioAPI, search: WatchedSearch): ScrapedListing[] {
    // AutoScout embeds all listing data in __NEXT_DATA__ as structured JSON
    const nextDataScript = $("#__NEXT_DATA__").html();
    if (!nextDataScript) return [];

    let nextData: any;
    try {
      nextData = JSON.parse(nextDataScript);
    } catch {
      return [];
    }

    const rawListings: NextDataListing[] = nextData?.props?.pageProps?.listings ?? [];
    const listings: ScrapedListing[] = [];
    const seen = new Set<string>();

    for (const raw of rawListings) {
      try {
        const externalId = raw.id;
        if (!externalId || seen.has(externalId)) continue;
        seen.add(externalId);

        const url = raw.url.startsWith("http")
          ? raw.url
          : `https://www.autoscout24.nl${raw.url}`;

        const price = this.parsePrice(raw.price?.priceFormatted);
        if (!price) continue;

        const detail = (iconName: string) =>
          raw.vehicleDetails?.find((d) => d.iconName === iconName)?.data ?? "";

        const mileage = this.parseMileage(raw.vehicle.mileageInKm ?? detail("mileage_odometer"));
        const year = this.parseYear(detail("calendar"));
        const fuelType = this.parseFuelType(raw.vehicle.fuel ?? detail("gas_pump"));
        const transmission = this.parseTransmission(raw.vehicle.transmission ?? detail("gearbox"));
        const powerKw = this.parsePowerKw(detail("speedometer"));

        const title = [
          raw.vehicle.make,
          raw.vehicle.model,
          raw.vehicle.modelVersionInput,
        ]
          .filter(Boolean)
          .join(" ");

        listings.push({
          externalId,
          url,
          make: search.make,
          model: search.model ?? raw.vehicle.model,
          year,
          mileage,
          fuelType,
          transmission,
          condition: Condition.USED_GOOD,
          price,
          title,
          imageUrls: raw.images ?? [],
          city: raw.location?.city ?? undefined,
          country: raw.location?.countryCode ?? "NL",
          rawData: { source: "autoscout24", powerKw, title },
        });
      } catch {
        // skip malformed listing
      }
    }

    return listings;
  }

  private toSlug(s: string): string {
    return s.toLowerCase().replace(/\s+/g, "-");
  }

  private parsePrice(text: string | undefined): number | null {
    if (!text) return null;
    const match = text.replace(/\./g, "").match(/(\d{3,7})/);
    if (!match) return null;
    const price = parseInt(match[1], 10);
    return price >= 500 && price <= 500000 ? price : null;
  }

  private parseMileage(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const match = text.replace(/\./g, "").match(/(\d{1,6})\s*km/i);
    if (!match) return undefined;
    const km = parseInt(match[1], 10);
    return km > 0 && km < 2000000 ? km : undefined;
  }

  private parseYear(text: string | undefined): number | undefined {
    if (!text) return undefined;
    // "03/1999" → 1999
    const slashMatch = text.match(/\d{2}\/(\d{4})/);
    if (slashMatch) return parseInt(slashMatch[1], 10);
    const yearMatch = text.match(/\b(19[89]\d|20[012]\d)\b/);
    return yearMatch ? parseInt(yearMatch[1], 10) : undefined;
  }

  private parseFuelType(text: string | undefined): FuelType | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();
    if (/elektrisch|electric|\bev\b|\bbev\b/.test(lower)) return FuelType.ELECTRIC;
    if (/hybride?|hybrid/.test(lower)) return FuelType.HYBRID;
    if (/diesel/.test(lower)) return FuelType.DIESEL;
    if (/lpg|autogas/.test(lower)) return FuelType.LPG;
    if (/benzine|petrol|benzin/.test(lower)) return FuelType.PETROL;
    return undefined;
  }

  private parseTransmission(text: string | undefined): Transmission | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();
    if (/automaat|automatic|dsg|automatis/.test(lower)) return Transmission.AUTOMATIC;
    if (/handgeschakeld|manual|schakel/.test(lower)) return Transmission.MANUAL;
    return undefined;
  }

  private parsePowerKw(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const match = text.match(/(\d+)\s*kW/i);
    return match ? parseInt(match[1], 10) : undefined;
  }
}

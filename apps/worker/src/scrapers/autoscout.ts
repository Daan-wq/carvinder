import { Condition, FuelType, Source, Transmission, type WatchedSearch } from "@autarb/db";
import { BaseScraper, type ScrapedListing } from "./base-scraper";

export class AutoScoutScraper extends BaseScraper {
  source = Source.AUTOSCOUT;

  buildSearchUrl(search: WatchedSearch, page: number): string {
    const params = new URLSearchParams();

    if (search.yearMin) params.append("yearFrom", String(search.yearMin));
    if (search.yearMax) params.append("yearTo", String(search.yearMax));
    if (search.mileageMax) params.append("kmTo", String(search.mileageMax));
    if (search.maxPrice) params.append("priceto", String(search.maxPrice));

    params.append("sort", "standard");
    params.append("desc", "0");
    params.append("ustate", "N,U");
    params.append("page", String(page));

    const make = this.toSlug(search.make);
    const model = search.model ? this.toSlug(search.model) : "";

    const path = model ? `${make}/${model}` : make;
    return `https://www.autoscout24.nl/lst/${path}/?${params.toString()}`;
  }

  parseListings(markdown: string): ScrapedListing[] {
    const listings: ScrapedListing[] = [];
    const seen = new Set<string>();

    // Split markdown into lines for context windows
    const lines = markdown.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Find AutoScout listing URLs (detail pages, not search pages)
      const linkMatch = line.match(
        /\[([^\]]{3,100})\]\((https:\/\/www\.autoscout24\.(?:nl|com|be|de)\/(?:auto|annonce|offerte)\/[^\s)]+)\)/
      );
      if (!linkMatch) continue;

      const [, title, url] = linkMatch;

      // Skip anchors to same-page sections, pagination links
      if (url.includes("#") || url.includes("?page=")) continue;

      const externalId = this.extractListingId(url);
      if (!externalId || seen.has(externalId)) continue;
      seen.add(externalId);

      // Build a context window: lines around the listing link
      const contextLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 8));
      const context = contextLines.join(" ");

      // Price: € followed by digits with optional dots (Dutch formatting)
      const priceMatch = context.match(/€\s*([\d.]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/\./g, ""), 10) : null;
      if (!price || price < 500 || price > 500000) continue;

      // Year: 4-digit year in 1990-2030 range
      const yearMatch = context.match(/\b(19[89]\d|20[0-2]\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

      // Mileage: number followed by km (Dutch: 85.000 km = 85000 km)
      const mileageMatch = context.match(/([\d.]+)\s*km\b/i);
      let mileage: number | undefined;
      if (mileageMatch) {
        const raw = mileageMatch[1].replace(/\./g, "");
        const num = parseInt(raw, 10);
        // If the number looks like it's already in km (>500), use as-is, otherwise x1000
        mileage = num > 500 ? num : num * 1000;
      }

      const fuelType = this.parseFuelTypeFromText(context);
      const transmission = this.parseTransmissionFromText(context);

      // AutoScout lists used cars (and some new). Default to USED_GOOD unless "Nieuw" is explicit.
      const condition = /\bnieuw\b/i.test(context) ? Condition.NEW : Condition.USED_GOOD;

      // City: often follows "in" or appears as standalone Dutch city name
      const cityMatch = context.match(/\b(?:in|te)\s+([A-Z][a-zÀ-ÿ]+(?:\s+[A-Z][a-zÀ-ÿ]+)?)/);
      const city = cityMatch ? cityMatch[1].trim() : undefined;

      // Use search make/model when available (more reliable than parsing the title)
      const make = this.currentSearch?.make ?? this.extractFirstWord(title);
      const model = this.currentSearch?.model ?? this.extractRemainingWords(title, make);

      listings.push({
        externalId,
        url,
        make,
        model,
        year,
        mileage,
        fuelType,
        transmission,
        condition,
        price,
        title: title.trim(),
        imageUrls: [],
        city,
        country: "NL",
        rawData: { source: "autoscout24", title },
      });
    }

    return listings;
  }

  parseDetailPage(markdown: string): Partial<ScrapedListing> {
    const details: Partial<ScrapedListing> = {};

    const fuelMatch = markdown.match(/(?:Brandstof|Fuel):\s*([A-Za-z\s]+?)(?:\n|,|$)/i);
    if (fuelMatch) details.fuelType = this.parseFuelTypeFromText(fuelMatch[1]);

    const transmissionMatch = markdown.match(/(?:Transmissie|Versnellingsbak|Gearbox):\s*([A-Za-z\s]+?)(?:\n|,|$)/i);
    if (transmissionMatch) details.transmission = this.parseTransmissionFromText(transmissionMatch[1]);

    const mileageMatch = markdown.match(/([\d.]+)\s*km\b/i);
    if (mileageMatch) {
      const raw = parseInt(mileageMatch[1].replace(/\./g, ""), 10);
      details.mileage = raw > 500 ? raw : raw * 1000;
    }

    const cityMatch = markdown.match(/(?:Locatie|Stad|Plaats|Location):\s*([A-ZÀ-Ÿ][a-zÀ-ÿ\s]+)/);
    if (cityMatch) details.city = cityMatch[1].trim();

    const descMatch = markdown.match(/(?:Beschrijving|Omschrijving|Description):\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\n|$)/i);
    if (descMatch) details.description = descMatch[1].trim().substring(0, 1000);

    return details;
  }

  private toSlug(s: string): string {
    return s.toLowerCase().replace(/\s+/g, "-");
  }

  private extractListingId(url: string): string {
    // AutoScout listing URLs: /auto/{make}/{model}/listing/{uuid} or /annonce/{uuid}
    const listingMatch = url.match(/\/listing\/([a-z0-9-]{8,})/i);
    if (listingMatch) return listingMatch[1];

    const annonceMatch = url.match(/\/annonce\/([a-z0-9-]{8,})/i);
    if (annonceMatch) return annonceMatch[1];

    // Fallback: last path segment
    const segments = url.split("/").filter(Boolean);
    return segments[segments.length - 1] || url;
  }

  private parseFuelTypeFromText(text: string): FuelType | undefined {
    const lower = text.toLowerCase();
    if (/\belektrisch\b|\belectric\b|\bev\b/.test(lower)) return FuelType.ELECTRIC;
    if (/\bhybride?\b|\bhybrid\b/.test(lower)) return FuelType.HYBRID;
    if (/\bdiesel\b/.test(lower)) return FuelType.DIESEL;
    if (/\blpg\b|\baardgas\b|\bcng\b/.test(lower)) return FuelType.LPG;
    if (/\bbenzine\b|\bpetrol\b|\bbenzin\b/.test(lower)) return FuelType.PETROL;
    return undefined;
  }

  private parseTransmissionFromText(text: string): Transmission | undefined {
    const lower = text.toLowerCase();
    if (/\bautomaat\b|\bautomatic\b/.test(lower)) return Transmission.AUTOMATIC;
    if (/\bhandgeschakeld\b|\bmanual\b|\bhandmatig\b/.test(lower)) return Transmission.MANUAL;
    return undefined;
  }

  private extractFirstWord(title: string): string {
    return title.split(/\s+/)[0] || "Unknown";
  }

  private extractRemainingWords(title: string, make: string): string {
    const rest = title.replace(new RegExp(`^${make}\\s*`, "i"), "");
    return rest.split(/\b\d{4}\b/)[0].trim() || "Unknown";
  }
}

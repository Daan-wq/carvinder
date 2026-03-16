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
    params.append("page", String(page));

    const make = encodeURIComponent(search.make);
    const model = search.model ? encodeURIComponent(search.model) : "null";

    return `https://www.autoscout24.nl/lst/${make}/${model}/?${params.toString()}`;
  }

  parseListings(markdown: string): ScrapedListing[] {
    const listings: ScrapedListing[] = [];

    const listingPattern =
      /\[([^\]]+)\]\((https:\/\/www\.autoscout24\.nl\/[^\s)]+)\)[^\n]*(?:€\s*([0-9.]+)|.)*(?:(\d+\.?\d*)\s*km|.)*(?:(\d{4})|.)/g;

    let match;
    while ((match = listingPattern.exec(markdown)) !== null) {
      const [, title, url, priceStr, mileageStr, yearStr] = match;

      const price = this.parsePrice(priceStr);
      if (!price) continue;

      const listing: ScrapedListing = {
        externalId: this.extractListingId(url),
        url,
        make: this.extractMake(title),
        model: this.extractModel(title),
        year: yearStr ? parseInt(yearStr, 10) : undefined,
        mileage: mileageStr ? Math.floor(parseFloat(mileageStr.replace(/\./g, "")) * 1000) : undefined,
        price,
        title,
        imageUrls: this.extractImageUrls(markdown, url),
        country: "NL",
        rawData: { source: "autoscout24", title },
      };

      listings.push(listing);
    }

    return listings;
  }

  parseDetailPage(markdown: string): Partial<ScrapedListing> {
    const details: Partial<ScrapedListing> = {};

    const fuelMatch = markdown.match(/(?:Brandstof|Fuel):\s*([A-Za-z\s]+?)(?:\n|,|$)/i);
    if (fuelMatch) {
      details.fuelType = this.parseFuelType(fuelMatch[1]);
    }

    const transmissionMatch = markdown.match(/(?:Transmissie|Transmission):\s*([A-Za-z\s]+?)(?:\n|,|$)/i);
    if (transmissionMatch) {
      details.transmission = this.parseTransmission(transmissionMatch[1]);
    }

    const mileageDetailMatch = markdown.match(/(\d+(?:\.\d+)?)\s*km\s*(?:km|gelopen|driven)/i);
    if (mileageDetailMatch && !details.mileage) {
      const km = Math.floor(parseFloat(mileageDetailMatch[1].replace(/\./g, "")) * 1000);
      details.mileage = km;
    }

    const cityMatch = markdown.match(/(?:Locatie|Location):\s*([A-Z][a-zA-Z\s]+)/);
    if (cityMatch) {
      details.city = cityMatch[1].trim();
    }

    const descriptionMatch = markdown.match(/(?:Beschrijving|Description):\s*([^\n]+(?:\n[^\n]*)*?)(?=\n\n|Brandstof|$)/i);
    if (descriptionMatch) {
      details.description = descriptionMatch[1].trim().substring(0, 1000);
    }

    return details;
  }

  private extractMake(title: string): string {
    const parts = title.split(/\s+/);
    return parts[0] || "Unknown";
  }

  private extractModel(title: string): string {
    const parts = title.split(/\s+/);
    return parts.slice(1).join(" ").split(/\d{4}/)[0].trim() || "Unknown";
  }

  private extractListingId(url: string): string {
    const match = url.match(/listing\/(\d+)/);
    if (match) return match[1];
    const hash = url.split("/").filter(p => /^\d+$/.test(p))[0];
    return hash || url;
  }

  private parsePrice(priceStr?: string): number | null {
    if (!priceStr) return null;
    const price = parseInt(priceStr.replace(/\./g, ""), 10);
    return isNaN(price) ? null : price;
  }

  private parseFuelType(fuel: string): FuelType | undefined {
    const lower = fuel.toLowerCase();
    if (lower.includes("benzine") || lower.includes("petrol")) return FuelType.PETROL;
    if (lower.includes("diesel")) return FuelType.DIESEL;
    if (lower.includes("lpg")) return FuelType.LPG;
    if (lower.includes("electric") || lower.includes("elektrisch")) return FuelType.ELECTRIC;
    if (lower.includes("hybrid")) return FuelType.HYBRID;
    return undefined;
  }

  private parseTransmission(transmission: string): Transmission | undefined {
    const lower = transmission.toLowerCase();
    if (lower.includes("manual") || lower.includes("handgeschakeld")) return Transmission.MANUAL;
    if (lower.includes("automatic") || lower.includes("automaat")) return Transmission.AUTOMATIC;
    return undefined;
  }

  private extractImageUrls(markdown: string, url: string): string[] {
    const imageUrls: string[] = [];
    const imagePattern = /!\[.*?\]\((https:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp)[^\s)]*)\)/gi;

    let match;
    while ((match = imagePattern.exec(markdown)) !== null) {
      imageUrls.push(match[1]);
      if (imageUrls.length >= 5) break;
    }

    return imageUrls;
  }
}

import { Condition, Source, type WatchedSearch } from "@autarb/db";
import { BaseScraper, type ScrapedListing } from "./base-scraper";

export class AuctionScraper extends BaseScraper {
  source = Source.AUCTION;

  buildSearchUrl(search: WatchedSearch, page: number): string {
    const query = [search.make, search.model].filter(Boolean).join("+");
    return `https://www.bfrauctions.com/search/?q=${encodeURIComponent(query)}&category=vehicles&page=${page}`;
  }

  parseListings(markdown: string): ScrapedListing[] {
    const listings: ScrapedListing[] = [];

    const pattern = /\[([^\]]+)\]\((https:\/\/www\.bfrauctions\.com\/[^\s)]+\/(\d+)[^\s)]*)\)[^\n]*?€\s?([0-9.,]+)/g;

    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const [, title, url, lotId, priceStr] = match;
      const price = parseInt(priceStr.replace(/[.,]/g, ""), 10);
      if (!price) continue;

      listings.push({
        externalId: `bfr-${lotId}`,
        url,
        make: this.extractMake(title),
        model: this.extractModel(title),
        price,
        title,
        condition: Condition.USED_FAIR,
        imageUrls: [],
        country: "NL",
        rawData: { source: "bfr-auctions", title },
      });
    }

    const troostwijkPattern = /\[([^\]]+)\]\((https:\/\/www\.troostwijkauctions\.com\/[^\s)]+)\)[^\n]*?€\s?([0-9.,]+)/g;

    while ((match = troostwijkPattern.exec(markdown)) !== null) {
      const [, title, url, priceStr] = match;
      const price = parseInt(priceStr.replace(/[.,]/g, ""), 10);
      if (!price) continue;

      const idMatch = url.match(/\/(\d+)\/?$/);
      const lotId = idMatch ? idMatch[1] : url;

      listings.push({
        externalId: `troost-${lotId}`,
        url,
        make: this.extractMake(title),
        model: this.extractModel(title),
        price,
        title,
        condition: Condition.USED_FAIR,
        imageUrls: [],
        country: "NL",
        rawData: { source: "troostwijk", title },
      });
    }

    return listings;
  }

  parseDetailPage(markdown: string): Partial<ScrapedListing> {
    const details: Partial<ScrapedListing> = {};

    const yearMatch = markdown.match(/(?:Year|Bouwjaar|Jaar):\s*(\d{4})/i);
    if (yearMatch) details.year = parseInt(yearMatch[1], 10);

    const kmMatch = markdown.match(/(?:Mileage|Km|Kilometerstand):\s*(\d[\d.]*)/i);
    if (kmMatch) details.mileage = parseInt(kmMatch[1].replace(/\./g, ""), 10);

    return details;
  }

  private extractMake(title: string): string {
    return title.split(/\s+/)[0] || "Unknown";
  }

  private extractModel(title: string): string {
    return title.split(/\s+/).slice(1, 3).join(" ") || "Unknown";
  }
}

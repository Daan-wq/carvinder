import { Source, type WatchedSearch } from "@autarb/db";
import { BaseScraper, type ScrapedListing } from "./base-scraper";

export class FacebookScraper extends BaseScraper {
  source = Source.FACEBOOK;

  buildSearchUrl(search: WatchedSearch, page: number): string {
    const params = new URLSearchParams({
      query: [search.make, search.model].filter(Boolean).join(" "),
      exact: "false",
    });

    if (search.maxPrice) params.append("maxPrice", String(search.maxPrice));
    if (search.mileageMax) params.append("maxMileage", String(search.mileageMax));

    return `https://www.facebook.com/marketplace/amsterdam/vehicles?${params.toString()}`;
  }

  parseListings(markdown: string): ScrapedListing[] {
    const listings: ScrapedListing[] = [];

    const pattern = /\[([^\]]+)\]\((https:\/\/www\.facebook\.com\/marketplace\/item\/(\d+)[^\s)]*)\)[^\n]*?€\s?([0-9.,]+)/g;

    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const [, title, url, itemId, priceStr] = match;
      const price = parseInt(priceStr.replace(/[.,]/g, ""), 10);
      if (!price || price < 100) continue;

      listings.push({
        externalId: itemId,
        url,
        make: title.split(/\s+/)[0] || "Unknown",
        model: title.split(/\s+/).slice(1, 3).join(" ") || "Unknown",
        price,
        title,
        imageUrls: [],
        country: "NL",
        rawData: { source: "facebook", title },
      });
    }

    return listings;
  }

  parseDetailPage(markdown: string): Partial<ScrapedListing> {
    const details: Partial<ScrapedListing> = {};

    const yearMatch = markdown.match(/(\d{4})/);
    if (yearMatch) details.year = parseInt(yearMatch[1], 10);

    const kmMatch = markdown.match(/(\d[\d.]*)\s*km/i);
    if (kmMatch) details.mileage = parseInt(kmMatch[1].replace(/\./g, ""), 10);

    const cityMatch = markdown.match(/(?:Location|Locatie):\s*([A-Za-z\s]+)/i);
    if (cityMatch) details.city = cityMatch[1].trim();

    return details;
  }
}

import { Condition, FuelType, Source, Transmission, type WatchedSearch } from "@autarb/db";
import { sleep } from "../utils/sleep";
import { FetchClient } from "./fetch-client";

export interface ScrapedListing {
  externalId: string;
  url: string;
  make: string;
  model: string;
  year?: number;
  mileage?: number;
  fuelType?: FuelType;
  transmission?: Transmission;
  condition?: Condition;
  price: number;
  title: string;
  description?: string;
  imageUrls: string[];
  city?: string;
  country?: string;
  rawData: Record<string, unknown>;
}

export interface ScraperConfig {
  maxListingsPerRun: number;
  delayBetweenRequests: number;
  maxPagesPerSearch: number;
}

const DEFAULT_CONFIG: ScraperConfig = {
  maxListingsPerRun: 50,
  delayBetweenRequests: 2000,
  maxPagesPerSearch: 3,
};

export abstract class BaseScraper {
  abstract source: Source;
  protected config: ScraperConfig;
  protected currentSearch: WatchedSearch | null = null;

  constructor(protected fetchClient: FetchClient, config?: Partial<ScraperConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  abstract buildSearchUrl(search: WatchedSearch, page: number): string;
  abstract parseListings(markdown: string): ScrapedListing[];
  abstract parseDetailPage(markdown: string): Partial<ScrapedListing>;

  async scrape(search: WatchedSearch): Promise<ScrapedListing[]> {
    this.currentSearch = search;
    const listings: ScrapedListing[] = [];

    for (let page = 1; page <= this.config.maxPagesPerSearch; page++) {
      if (listings.length >= this.config.maxListingsPerRun) break;

      const url = this.buildSearchUrl(search, page);

      try {
        const { markdown } = await this.fetchClient.fetchPage(url);
        const pageListings = this.parseListings(markdown);

        if (pageListings.length === 0) break;

        for (const listing of pageListings) {
          if (listings.length >= this.config.maxListingsPerRun) break;
          listings.push(listing);
        }
      } catch (error) {
        console.error(`Error scraping page ${page}:`, error);
        break;
      }

      await sleep(this.config.delayBetweenRequests);
    }

    return listings;
  }

  async enrichListing(listing: ScrapedListing): Promise<ScrapedListing> {
    try {
      const { markdown } = await this.fetchClient.fetchPage(listing.url);
      const details = this.parseDetailPage(markdown);
      return { ...listing, ...details };
    } catch {
      return listing;
    }
  }
}

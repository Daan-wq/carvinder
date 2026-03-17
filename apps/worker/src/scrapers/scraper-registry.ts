import { Source, type WatchedSearch } from "@autarb/db";
import { AuctionScraper } from "./auctions";
import { AutoScoutScraper } from "./autoscout";
import type { ScrapedListing } from "./base-scraper";
import { FacebookScraper } from "./facebook";
import { FetchClient } from "./fetch-client";
import { HtmlClient } from "./html-client";
import { MarktplaatsScraper } from "./marktplaats";

export interface Scraper {
  source: Source;
  scrape(search: WatchedSearch): Promise<ScrapedListing[]>;
}

export function getScraperForSource(source: Source, fetchClient: FetchClient): Scraper | null {
  switch (source) {
    case Source.MARKTPLAATS:
      return new MarktplaatsScraper(fetchClient);
    case Source.AUTOSCOUT:
      return new AutoScoutScraper(new HtmlClient());
    case Source.FACEBOOK:
      return new FacebookScraper(fetchClient);
    case Source.AUCTION:
      return new AuctionScraper(fetchClient);
    default:
      return null;
  }
}

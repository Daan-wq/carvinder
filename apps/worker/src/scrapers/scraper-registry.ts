import { Source } from "@autarb/db";
import { AuctionScraper } from "./auctions";
import { AutoScoutScraper } from "./autoscout";
import { BaseScraper } from "./base-scraper";
import { FacebookScraper } from "./facebook";
import { FetchClient } from "./fetch-client";
import { MarktplaatsScraper } from "./marktplaats";

export function getScraperForSource(source: Source, fetchClient: FetchClient): BaseScraper | null {
  switch (source) {
    case Source.MARKTPLAATS:
      return new MarktplaatsScraper(fetchClient);
    case Source.AUTOSCOUT:
      return new AutoScoutScraper(fetchClient);
    case Source.FACEBOOK:
      return new FacebookScraper(fetchClient);
    case Source.AUCTION:
      return new AuctionScraper(fetchClient);
    default:
      return null;
  }
}

import { Condition, FuelType, Source, Transmission, type WatchedSearch } from "@autarb/db";
import { HtmlClient } from "./html-client";
import type { ScrapedListing } from "./base-scraper";

export class AutoScoutScraper {
  readonly source = Source.AUTOSCOUT;

  private readonly maxListingsPerRun = 100;
  private readonly maxPagesPerSearch = 5;

  constructor(private client: HtmlClient) {}

  buildSearchUrl(search: WatchedSearch, page: number): string {
    const params = new URLSearchParams();
    params.set("sort", "standard");
    params.set("desc", "0");
    params.set("ustate", "N,U");
    params.set("cy", "NL");
    params.set("atype", "C");
    params.set("page", String(page));

    if (search.yearMin) params.set("yearFrom", String(search.yearMin));
    if (search.yearMax) params.set("yearTo", String(search.yearMax));
    if (search.mileageMax) params.set("kmTo", String(search.mileageMax));
    if (search.maxPrice) params.set("priceto", String(search.maxPrice));

    const make = this.toSlug(search.make);
    const model = search.model ? this.toSlug(search.model) : "";
    const path = model ? `${make}/${model}` : make;

    return `https://www.autoscout24.nl/lst/${path}/?${params.toString()}`;
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

  parseListings($: cheerio.CheerioAPI, search: WatchedSearch): ScrapedListing[] {
    const listings: ScrapedListing[] = [];
    const seen = new Set<string>();

    $("article.cldt-summary-full-item, article[data-item-name='listing-item']").each((_, el) => {
      try {
        const article = $(el);

        // URL + ID
        const linkEl = article.find("a[href*='/auto/'], a[href*='/offers/']").first();
        const href = linkEl.attr("href") || article.find("a").first().attr("href");
        if (!href) return;

        const url = href.startsWith("http") ? href : `https://www.autoscout24.nl${href}`;
        const externalId = this.extractId(url);
        if (!externalId || seen.has(externalId)) return;
        seen.add(externalId);

        // Title
        const title = article.find("[class*='ListItem_title'], h2, .cldt-summary-titles").first().text().trim()
          || article.find("a").first().text().trim();
        if (!title) return;

        // Price — € 16.950 or €16950
        const priceText = article.find("[class*='Price_price'], .cldt-price, [data-testid='price']").first().text()
          || article.find("p, span").filter((_, e) => /€/.test($(e).text())).first().text();
        const price = this.parsePrice(priceText);
        if (!price) return;

        // Mileage
        const mileageText = article.find("[data-testid='VehicleDetails-mileage_road'], [data-testid*='mileage']").text()
          || article.find("span, li").filter((_, e) => /\d+[\s.]?\d*\s*km/i.test($(e).text())).first().text();
        const mileage = this.parseMileage(mileageText);

        // Year — either "07/2020" format or just "2020"
        const yearText = article.find("[data-testid='VehicleDetails-calendar'], [data-testid*='calendar']").text()
          || article.find("span, li").filter((_, e) => /\d{2}\/\d{4}|\b20\d{2}\b/.test($(e).text())).first().text();
        const year = this.parseYear(yearText);

        // Fuel type
        const fuelText = article.find("[data-testid='VehicleDetails-gas_pump'], [data-testid*='fuel']").text()
          || article.text();
        const fuelType = this.parseFuelType(fuelText);

        // Transmission
        const transmissionText = article.find("[data-testid='VehicleDetails-transmission'], [data-testid*='transmission']").text()
          || article.text();
        const transmission = this.parseTransmission(transmissionText);

        // Power
        const powerText = article.find("[data-testid='VehicleDetails-speedometer'], [data-testid*='power']").text();
        const powerKw = this.parsePowerKw(powerText);

        // Seller city
        const city = article.find("[class*='SellerInfo'], .cldt-summary-seller-contact, [data-testid*='seller']")
          .text().match(/NL[-\s]*\d+\s+([A-Z][A-Z\s]+)/)?.[1]?.trim();

        // Image
        const imgSrc = article.find("img[src*='autoscout24']").first().attr("src")
          || article.find("img").first().attr("src");
        const imageUrls = imgSrc ? [imgSrc] : [];

        listings.push({
          externalId,
          url,
          make: search.make,
          model: search.model ?? this.extractModel(title, search.make),
          year,
          mileage,
          fuelType,
          transmission,
          condition: Condition.USED_GOOD,
          price,
          title,
          imageUrls,
          city: city ?? undefined,
          country: "NL",
          rawData: { source: "autoscout24", powerKw, title },
        });
      } catch (err) {
        // skip malformed listing
      }
    });

    return listings;
  }

  private toSlug(s: string): string {
    return s.toLowerCase().replace(/\s+/g, "-");
  }

  private extractId(url: string): string | null {
    // /offers/bmw-318d-...-12345678 or /auto/.../listing/uuid
    const listingMatch = url.match(/\/listing\/([a-f0-9-]{8,})/i);
    if (listingMatch) return listingMatch[1];

    const offersMatch = url.match(/\/offers\/[^?#]+?-(\d+)(?:[?#]|$)/);
    if (offersMatch) return offersMatch[1];

    const segments = url.replace(/[?#].*$/, "").split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last || null;
  }

  private parsePrice(text: string): number | null {
    if (!text) return null;
    const match = text.replace(/\./g, "").match(/(\d{3,7})/);
    if (!match) return null;
    const price = parseInt(match[1], 10);
    return price >= 500 && price <= 500000 ? price : null;
  }

  private parseMileage(text: string): number | undefined {
    if (!text) return undefined;
    const match = text.replace(/\./g, "").match(/(\d{1,6})\s*km/i);
    if (!match) return undefined;
    const km = parseInt(match[1], 10);
    return km > 0 && km < 2000000 ? km : undefined;
  }

  private parseYear(text: string): number | undefined {
    if (!text) return undefined;
    // "07/2021" → 2021
    const slashMatch = text.match(/\d{2}\/(\d{4})/);
    if (slashMatch) return parseInt(slashMatch[1], 10);
    const yearMatch = text.match(/\b(19[89]\d|20[012]\d)\b/);
    return yearMatch ? parseInt(yearMatch[1], 10) : undefined;
  }

  private parseFuelType(text: string): FuelType | undefined {
    const lower = text.toLowerCase();
    if (/elektrisch|electric|\bev\b|\bbev\b/.test(lower)) return FuelType.ELECTRIC;
    if (/hybride?|hybrid/.test(lower)) return FuelType.HYBRID;
    if (/diesel/.test(lower)) return FuelType.DIESEL;
    if (/lpg|autogas/.test(lower)) return FuelType.LPG;
    if (/benzine|petrol|benzin/.test(lower)) return FuelType.PETROL;
    return undefined;
  }

  private parseTransmission(text: string): Transmission | undefined {
    const lower = text.toLowerCase();
    if (/automaat|automatic|dsg|automatis/.test(lower)) return Transmission.AUTOMATIC;
    if (/handgeschakeld|manual|schakel/.test(lower)) return Transmission.MANUAL;
    return undefined;
  }

  private parsePowerKw(text: string): number | undefined {
    const match = text.match(/(\d+)\s*kW/i);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private extractModel(title: string, make: string): string {
    const rest = title.replace(new RegExp(`^${make}\\s*`, "i"), "");
    return rest.split(/\b\d{4}\b/)[0].trim() || "Unknown";
  }
}

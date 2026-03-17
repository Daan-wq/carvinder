import axios from "axios";
import * as cheerio from "cheerio";
import { sleep } from "../utils/sleep";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

export interface HtmlFetchResult {
  $: cheerio.CheerioAPI;
  html: string;
}

/**
 * HTTP client with a sequential request queue.
 * No matter how many callers invoke fetchPage concurrently,
 * actual HTTP requests are serialized with a 2.5–4.5s delay between them.
 * This prevents 429 rate-limiting on a single IP.
 */
export class HtmlClient {
  private requestCount = 0;
  // Chain all fetches so they execute one-at-a-time
  private queue: Promise<void> = Promise.resolve();

  private randomAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  fetchPage(url: string): Promise<HtmlFetchResult> {
    const result = this.queue.then(async (): Promise<HtmlFetchResult> => {
      // Polite delay between every request (2.5–4.5 s)
      if (this.requestCount > 0) {
        await sleep(2500 + Math.random() * 2000);
      }
      this.requestCount++;
      return this._doFetch(url);
    });

    // Advance the queue; ignore errors so a failed fetch doesn't block the chain
    this.queue = result.then(() => {}, () => {});

    return result;
  }

  private async _doFetch(url: string): Promise<HtmlFetchResult> {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": this.randomAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://www.autoscout24.nl/",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      timeout: 20000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data as string);
    return { $, html: response.data as string };
  }
}

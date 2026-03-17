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

export class HtmlClient {
  private requestCount = 0;

  private randomAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async fetchPage(url: string): Promise<HtmlFetchResult> {
    this.requestCount++;

    // Polite delay: 1-2s between requests
    if (this.requestCount > 1) {
      await sleep(1000 + Math.random() * 1000);
    }

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
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data as string);
    return { $, html: response.data as string };
  }
}

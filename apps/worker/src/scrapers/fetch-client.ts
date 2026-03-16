import FirecrawlApp from "@mendable/firecrawl-js";
import { CreditTracker } from "./credit-tracker";

export interface FetchResult {
  markdown: string;
  provider: "firecrawl" | "cloudflare";
}

export class FetchClient {
  private firecrawl: FirecrawlApp;
  private cloudflareAccountId: string;
  private cloudflareApiToken: string;

  constructor(private creditTracker: CreditTracker) {
    const apiKey = process.env.FIRECRAWL_API;
    if (!apiKey) throw new Error("FIRECRAWL_API env var required");

    this.firecrawl = new FirecrawlApp({ apiKey });
    this.cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
    this.cloudflareApiToken = process.env.CLOUDFLARE_CRAWL_API || "";
  }

  async fetchPage(url: string): Promise<FetchResult> {
    const canUseFirecrawl = await this.creditTracker.canUseFirecrawl();

    if (canUseFirecrawl) {
      try {
        const result = await this.firecrawl.scrape(url, {
          formats: ["markdown"],
        });

        const creditUsed = result.metadata?.creditsUsed ?? 1;
        await this.creditTracker.recordUsage(creditUsed);

        return {
          markdown: result.markdown || "",
          provider: "firecrawl",
        };
      } catch (error) {
        console.warn(`Firecrawl error for ${url}:`, error);
        return this.fetchWithCloudflare(url);
      }
    }

    return this.fetchWithCloudflare(url);
  }

  private async fetchWithCloudflare(url: string): Promise<FetchResult> {
    if (!this.cloudflareAccountId || !this.cloudflareApiToken) {
      throw new Error(
        "Cloudflare credentials missing (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_CRAWL_API)"
      );
    }

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.cloudflareAccountId}/browser-rendering/content`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`Cloudflare API error: ${response.status}`);
      }

      const data = (await response.json()) as { content?: string };
      const html = data.content || "";
      const markdown = this.htmlToMarkdown(html);

      return {
        markdown,
        provider: "cloudflare",
      };
    } catch (error) {
      throw new Error(`Cloudflare fetch failed for ${url}: ${String(error)}`);
    }
  }

  private htmlToMarkdown(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/p>/gi, "\n")
      .replace(/<div[^>]*>/gi, "")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}

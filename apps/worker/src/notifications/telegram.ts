import { prisma, type CarListing } from "@autarb/db";

export interface DealWithDetails {
  listing: CarListing;
  discountPercent: number;
  discountEuros: number;
  averagePrice: number;
}

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    this.chatId = process.env.TELEGRAM_CHAT_ID || "";
  }

  async sendDealBatch(deals: DealWithDetails[]): Promise<void> {
    if (!this.botToken || !this.chatId) {
      console.warn("Telegram credentials not configured. Skipping notification.");
      await this.logNotification(deals.length, "skipped", "Missing credentials", false);
      return;
    }

    const message = this.formatMessage(deals);

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: message,
            parse_mode: "HTML",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.status}`);
      }

      await this.logNotification(deals.length, message, null, true);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to send Telegram notification:", error);
      await this.logNotification(deals.length, message, errorMsg, false);
    }
  }

  private formatMessage(deals: DealWithDetails[]): string {
    let msg = `🚗 <b>AutoArb — ${deals.length} new deal${deals.length !== 1 ? "s" : ""}!</b>\n\n`;

    deals.forEach((deal, idx) => {
      const num = idx + 1;
      const listing = deal.listing;

      msg += `<b>${num}️⃣ ${deal.discountPercent.toFixed(0)}% below market</b>\n`;
      msg += `${listing.make} ${listing.model}`;
      if (listing.year) msg += ` ${listing.year}`;
      if (listing.mileage) msg += ` — ${(listing.mileage / 1000).toFixed(0)}k km`;
      if (listing.fuelType) msg += ` ${listing.fuelType}`;
      msg += "\n";

      msg += `💰 <b>€${listing.price}</b> | Avg: €${deal.averagePrice} | Save: €${deal.discountEuros}\n`;

      if (listing.city) msg += `📍 ${listing.city} | `;
      msg += `${listing.source}\n`;

      msg += `🔗 <a href="${listing.url}">View listing</a>\n\n`;
    });

    return msg;
  }

  private async logNotification(
    dealCount: number,
    message: string,
    error: string | null | undefined,
    success: boolean
  ): Promise<void> {
    try {
      await prisma.notificationLog.create({
        data: {
          type: "telegram",
          dealCount,
          message: message.substring(0, 500),
          success,
          error: error || undefined,
        },
      });
    } catch (e) {
      console.error("Failed to log notification:", e);
    }
  }
}

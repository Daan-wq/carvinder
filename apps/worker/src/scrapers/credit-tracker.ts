import { prisma } from "@autarb/db";

export class CreditTracker {
  private monthKey: string;
  private monthlyLimit: number;

  constructor() {
    this.monthKey = this.getCurrentMonthKey();
    this.monthlyLimit = parseInt(process.env.FIRECRAWL_MONTHLY_LIMIT || "500", 10);
  }

  async canUseFirecrawl(): Promise<boolean> {
    const usage = await this.getMonthlyUsage();
    return usage.used < usage.limit;
  }

  async recordUsage(credits: number): Promise<void> {
    const current = await prisma.creditUsage.findUnique({
      where: { month: this.monthKey },
    });

    if (current) {
      await prisma.creditUsage.update({
        where: { month: this.monthKey },
        data: { creditsUsed: current.creditsUsed + credits },
      });
    } else {
      await prisma.creditUsage.create({
        data: {
          month: this.monthKey,
          creditsUsed: credits,
          creditLimit: this.monthlyLimit,
        },
      });
    }
  }

  async getRemainingCredits(): Promise<number> {
    const usage = await this.getMonthlyUsage();
    return Math.max(0, usage.limit - usage.used);
  }

  async getMonthlyUsage(): Promise<{ used: number; limit: number }> {
    const current = await prisma.creditUsage.findUnique({
      where: { month: this.monthKey },
    });

    return {
      used: current?.creditsUsed ?? 0,
      limit: this.monthlyLimit,
    };
  }

  private getCurrentMonthKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }
}

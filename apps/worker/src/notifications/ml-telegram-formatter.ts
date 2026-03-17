import { type DealTier } from "@autarb/db";

interface MLDealNotification {
  make: string;
  model: string;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  price: number;
  predictedP50: number;
  predictedP10: number;
  predictedP90: number;
  dealTier: DealTier;
  dealScore: number;
  confidence: number;
  city: string | null;
  source: string;
  url: string;
  hasRedFlags: boolean;
}

const TIER_EMOJI: Record<DealTier, string> = {
  OUTSTANDING: "🟢🟢",
  GREAT: "🟢",
  FAIR: "⚪",
  HIGH: "🟠",
  OVERPRICED: "🔴",
};

const TIER_LABEL_NL: Record<DealTier, string> = {
  OUTSTANDING: "UITSTEKENDE DEAL",
  GREAT: "GOEDE DEAL",
  FAIR: "EERLIJKE PRIJS",
  HIGH: "HOGE PRIJS",
  OVERPRICED: "TE DUUR",
};

function formatPrice(value: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMileage(km: number | null): string {
  if (km === null) return "onbekend";
  return new Intl.NumberFormat("nl-NL").format(km) + " km";
}

export function formatMLDealMessage(deals: MLDealNotification[]): string {
  if (deals.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    `<b>🚗 ${deals.length} nieuwe deal${deals.length > 1 ? "s" : ""} gevonden</b>\n`
  );

  for (const deal of deals) {
    const emoji = TIER_EMOJI[deal.dealTier];
    const tierLabel = TIER_LABEL_NL[deal.dealTier];
    const savings = deal.predictedP50 - deal.price;
    const savingsPct = Math.round((savings / deal.predictedP50) * 100);
    const confidencePct = Math.round(deal.confidence * 100);

    lines.push(
      `${emoji} <b>${tierLabel}</b> — ${deal.make} ${deal.model} ${deal.year || ""}`
    );
    lines.push(
      `💰 ${formatPrice(deal.price)} (voorspeld: ${formatPrice(deal.predictedP50)})`
    );
    lines.push(
      `📊 Bereik: ${formatPrice(deal.predictedP10)} – ${formatPrice(deal.predictedP90)}`
    );

    if (savings > 0) {
      lines.push(
        `✅ Besparing: ${formatPrice(savings)} (${savingsPct}% onder mediaan)`
      );
    }

    lines.push(
      `⭐ Vertrouwen: ${confidencePct}% | ${deal.fuelType || "onbekend"} | ${formatMileage(deal.mileage)}`
    );

    if (deal.hasRedFlags) {
      lines.push(
        `⚠️ Let op: mogelijke aandachtspunten in advertentie`
      );
    }

    lines.push(`📍 ${deal.city || "Onbekend"} | ${deal.source}`);
    lines.push(`👉 <a href="${deal.url}">Bekijk advertentie</a>\n`);
  }

  return lines.join("\n");
}

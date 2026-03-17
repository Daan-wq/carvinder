import { prisma } from "@autarb/db";

// Red-flag keywords with severity weights
const RED_FLAG_KEYWORDS: Record<string, { weight: number; category: string }> = {
  // Damage
  schade: { weight: 0.8, category: "damage" },
  schadeauto: { weight: 0.9, category: "damage" },
  ongeval: { weight: 0.9, category: "damage" },
  aanrijding: { weight: 0.9, category: "damage" },
  "total loss": { weight: 1.0, category: "damage" },
  beschadigd: { weight: 0.7, category: "damage" },
  roest: { weight: 0.6, category: "damage" },
  deuk: { weight: 0.5, category: "damage" },
  deuken: { weight: 0.5, category: "damage" },
  // Non-running
  "niet rijdend": { weight: 0.9, category: "non_running" },
  defect: { weight: 0.7, category: "non_running" },
  "motor kapot": { weight: 0.9, category: "non_running" },
  "voor onderdelen": { weight: 1.0, category: "non_running" },
  sloop: { weight: 0.9, category: "non_running" },
  // No APK
  "geen apk": { weight: 0.8, category: "no_apk" },
  "apk verlopen": { weight: 0.7, category: "no_apk" },
  "zonder apk": { weight: 0.8, category: "no_apk" },
  // Export
  export: { weight: 0.6, category: "export" },
  geëxporteerd: { weight: 0.8, category: "export" },
  uitgeschreven: { weight: 0.7, category: "export" },
  // Project
  project: { weight: 0.5, category: "project" },
  opknapper: { weight: 0.6, category: "project" },
  restauratie: { weight: 0.5, category: "project" },
};

const PREMIUM_KEYWORDS: Record<string, number> = {
  leder: 0.7,
  lederen: 0.7,
  leer: 0.6,
  panoramadak: 0.8,
  panorama: 0.6,
  navigatie: 0.5,
  navi: 0.4,
  trekhaak: 0.4,
  winterbanden: 0.3,
  keyless: 0.5,
  sportpakket: 0.7,
  "s-line": 0.6,
  "m-pakket": 0.7,
  amg: 0.8,
  "r-line": 0.6,
  "head-up": 0.6,
  stoelverwarming: 0.4,
  achteruitrijcamera: 0.4,
  "harman kardon": 0.5,
  bose: 0.4,
  "bang olufsen": 0.5,
  "dealer onderhouden": 0.6,
  "1e eigenaar": 0.5,
  "eerste eigenaar": 0.5,
  nieuwstaat: 0.6,
};

const PLACEHOLDER_PRICES = new Set([0, 1, 2, 99, 100, 111, 123, 999, 1234, 9999, 99999, 12345]);

interface NLPResult {
  hasDamageKeywords: boolean;
  hasNonRunningKeywords: boolean;
  hasNoApkKeywords: boolean;
  hasExportKeywords: boolean;
  hasProjectKeywords: boolean;
  hasPremiumKeywords: boolean;
  redFlagCount: number;
  redFlagScore: number;
  premiumFlagCount: number;
  premiumFlagScore: number;
  descriptionLength: number;
  descriptionQuality: number;
  photoCount: number;
  isPlaceholderPrice: boolean;
}

export function extractNLPFeatures(
  description: string | null,
  title: string | null,
  price: number,
  photoCount: number
): NLPResult {
  const text = ((title || "") + " " + (description || "")).toLowerCase().trim();

  // Check categories
  const categories = new Set<string>();
  let redFlagCount = 0;
  let redFlagScore = 0;

  for (const [keyword, info] of Object.entries(RED_FLAG_KEYWORDS)) {
    const regex = new RegExp(
      `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    );
    if (regex.test(text)) {
      categories.add(info.category);
      redFlagCount++;
      redFlagScore += info.weight;
    }
  }

  let premiumFlagCount = 0;
  let premiumFlagScore = 0;

  for (const [keyword, weight] of Object.entries(PREMIUM_KEYWORDS)) {
    const regex = new RegExp(
      `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    );
    if (regex.test(text)) {
      premiumFlagCount++;
      premiumFlagScore += weight;
    }
  }

  // Description quality
  const descLen = description?.length || 0;
  let descQuality = 0;
  if (descLen >= 2000) descQuality = 1.0;
  else if (descLen >= 1000) descQuality = 0.85;
  else if (descLen >= 500) descQuality = 0.7;
  else if (descLen >= 200) descQuality = 0.5;
  else if (descLen >= 50) descQuality = 0.3;
  else if (descLen > 0) descQuality = 0.1;

  if (photoCount >= 15) descQuality = Math.min(1.0, descQuality + 0.1);
  else if (photoCount <= 2) descQuality = Math.max(0.0, descQuality - 0.1);

  // Placeholder price
  let isPlaceholder = PLACEHOLDER_PRICES.has(price);
  if (!isPlaceholder && price >= 0 && price <= 10) isPlaceholder = true;
  if (!isPlaceholder && price > 100 && price % 1000 === 0 && descLen < 50)
    isPlaceholder = true;

  return {
    hasDamageKeywords: categories.has("damage"),
    hasNonRunningKeywords: categories.has("non_running"),
    hasNoApkKeywords: categories.has("no_apk"),
    hasExportKeywords: categories.has("export"),
    hasProjectKeywords: categories.has("project"),
    hasPremiumKeywords: premiumFlagCount > 0,
    redFlagCount,
    redFlagScore: Math.min(1.0, redFlagScore),
    premiumFlagCount,
    premiumFlagScore: Math.min(1.0, premiumFlagScore),
    descriptionLength: descLen,
    descriptionQuality: Math.round(descQuality * 100) / 100,
    photoCount,
    isPlaceholderPrice: isPlaceholder,
  };
}

export async function extractAndStoreNLPFeatures(
  listingId: string,
  description: string | null,
  title: string | null,
  price: number,
  photoCount: number
): Promise<void> {
  const features = extractNLPFeatures(description, title, price, photoCount);

  await prisma.listingNLPFeatures.upsert({
    where: { listingId },
    create: {
      listingId,
      ...features,
    },
    update: {
      ...features,
    },
  });
}

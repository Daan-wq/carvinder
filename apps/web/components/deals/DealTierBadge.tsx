import React from "react"

interface DealTierBadgeProps {
  tier: string
  size?: "sm" | "md" | "lg"
}

const tierConfig: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  OUTSTANDING: {
    bg: "bg-emerald-600",
    text: "text-white",
    label: "Uitstekend",
  },
  GREAT: {
    bg: "bg-emerald-500",
    text: "text-white",
    label: "Goede deal",
  },
  FAIR: {
    bg: "bg-gray-200",
    text: "text-gray-700",
    label: "Eerlijk",
  },
  HIGH: {
    bg: "bg-orange-100",
    text: "text-orange-700",
    label: "Hoog",
  },
  OVERPRICED: {
    bg: "bg-red-100",
    text: "text-red-700",
    label: "Te duur",
  },
}

const sizeConfig: Record<string, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
  lg: "px-4 py-2 text-base",
}

export function DealTierBadge({
  tier,
  size = "md",
}: DealTierBadgeProps) {
  const config = tierConfig[tier] || tierConfig.FAIR
  const sizeClass = sizeConfig[size]

  return (
    <div
      className={`inline-flex items-center rounded-full font-semibold ${config.bg} ${config.text} ${sizeClass}`}
    >
      {config.label}
    </div>
  )
}

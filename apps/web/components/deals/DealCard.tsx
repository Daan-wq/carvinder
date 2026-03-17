"use client"

import { ExternalLink, Clock, Car } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DealTierBadge } from "./DealTierBadge"
import { ConfidenceMeter } from "./ConfidenceMeter"
import { PriceRangeBar } from "./PriceRangeBar"
import { DealScoreIndicator } from "./DealScoreIndicator"

interface Listing {
  make: string
  model: string
  year: number | null
  mileage: number | null
  fuelType: string | null
  source: string
  url: string
  city: string | null
  imageUrls?: string[]
}

interface MlPrediction {
  predictedP10: number
  predictedP50: number
  predictedP90: number
  suspicionFlag: boolean
  coverageLevel: number
  effectiveDealTier: string
}

interface DealCardProps {
  id: string
  discountPercent: number
  discountEuros: number
  listingPrice: number
  averagePrice: number
  isAcknowledged: boolean
  createdAt: string
  dealTier: string | null
  dealScore: number | null
  confidence: number | null
  isMLGenerated: boolean
  mlPrediction: MlPrediction | null
  listing: Listing
  viewMode?: "card" | "list"
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (hours < 1) return "Zojuist"
  if (hours < 24) return `${hours}u geleden`
  if (days < 7) return `${days}d geleden`
  return d.toLocaleDateString("nl-NL")
}

function formatMileage(mileage: number | null): string {
  if (mileage === null) return "-"
  return new Intl.NumberFormat("nl-NL").format(mileage) + " km"
}

function getSourceColor(
  source: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (source) {
    case "AUTOSCOUT":
      return "default"
    case "MARKTPLAATS":
      return "secondary"
    case "FACEBOOK":
      return "outline"
    default:
      return "outline"
  }
}

function CarImage({ listing, className }: { listing: Listing; className?: string }) {
  const src = listing.imageUrls?.[0]

  return (
    <div className={`relative bg-gray-100 overflow-hidden ${className ?? ""}`}>
      {src ? (
        <img
          src={src}
          alt={`${listing.make} ${listing.model}`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Car className="w-8 h-8 text-gray-300" />
        </div>
      )}
    </div>
  )
}

export function DealCard(props: DealCardProps) {
  const { viewMode = "card" } = props

  if (viewMode === "list") {
    return <DealCardList {...props} />
  }

  return <DealCardFull {...props} />
}

function DealCardFull(props: DealCardProps) {
  const { mlPrediction, dealTier, dealScore, confidence } = props

  if (mlPrediction && dealTier && dealScore !== null && confidence !== null) {
    return (
      <Card className="overflow-hidden border-l-4 border-l-blue-500 hover:shadow-lg transition-shadow">
        <div className="flex">
          <CarImage listing={props.listing} className="w-48 min-h-[160px] flex-shrink-0 hidden sm:block" />

          <div className="flex-1 p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Left: Tier + Car Info */}
              <div className="space-y-3">
                <DealTierBadge tier={dealTier} size="lg" />
                <div>
                  <h3 className="text-lg font-bold">
                    {props.listing.make} {props.listing.model}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {props.listing.year ?? "-"} • {formatMileage(props.listing.mileage)}{" "}
                    {props.listing.fuelType && `• ${props.listing.fuelType}`}
                    {props.listing.city && ` • ${props.listing.city}`}
                  </p>
                </div>
              </div>

              {/* Center: Price */}
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-3xl font-bold text-blue-600">
                    {formatPrice(props.listingPrice)}
                  </div>
                  {props.discountEuros > 0 && (
                    <div className="text-sm text-emerald-600 font-medium mt-1">
                      Besparing: {formatPrice(props.discountEuros)} (
                      {Math.round(props.discountPercent)}%)
                    </div>
                  )}
                </div>

                <PriceRangeBar
                  predictedP10={mlPrediction.predictedP10}
                  predictedP50={mlPrediction.predictedP50}
                  predictedP90={mlPrediction.predictedP90}
                  actualPrice={props.listingPrice}
                />
              </div>

              {/* Right: Metrics & Actions */}
              <div className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-2">
                      Betrouwbaarheid
                    </label>
                    <ConfidenceMeter confidence={confidence} />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-2">
                      Score
                    </label>
                    <DealScoreIndicator
                      score={dealScore}
                      suspicionFlag={mlPrediction.suspicionFlag}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-200 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDate(props.createdAt)}
                  </div>

                  <Badge variant={getSourceColor(props.listing.source)}>
                    {props.listing.source}
                  </Badge>

                  {!props.isAcknowledged && (
                    <Badge variant="default">Nieuw</Badge>
                  )}
                </div>

                <a
                  href={props.listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full mt-2"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full flex items-center justify-center gap-2"
                  >
                    Bekijk
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  // Legacy deal (no ML data)
  return (
    <Card className="overflow-hidden border-l-4 border-l-gray-300 hover:shadow-lg transition-shadow">
      <div className="flex">
        <CarImage listing={props.listing} className="w-48 min-h-[120px] flex-shrink-0 hidden sm:block" />

        <div className="flex-1 p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <div>
              <h3 className="text-lg font-bold">
                {props.listing.make} {props.listing.model}
              </h3>
              <p className="text-sm text-gray-600">
                {props.listing.year ?? "-"} • {formatMileage(props.listing.mileage)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-2xl font-bold text-blue-600">
                {formatPrice(props.listingPrice)}
              </div>
              <Badge variant="secondary">
                {Math.round(props.discountPercent)}% korting
              </Badge>
            </div>

            <div className="flex items-center justify-between md:justify-end gap-2">
              <div className="flex flex-col items-end gap-1">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-600">
                  {formatDate(props.createdAt)}
                </span>
              </div>
              <a
                href={props.listing.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="ghost"
                  size="icon"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function DealCardList(props: DealCardProps) {
  const { dealTier, dealScore, confidence } = props

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex items-center gap-4 p-3">
        {/* Small Image */}
        <CarImage listing={props.listing} className="w-20 h-14 flex-shrink-0 rounded" />

        {/* Car Info */}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">
            {props.listing.make} {props.listing.model}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {props.listing.year ?? "-"} • {formatMileage(props.listing.mileage)}
            {props.listing.fuelType && ` • ${props.listing.fuelType}`}
            {props.listing.city && ` • ${props.listing.city}`}
          </div>
        </div>

        {/* Price */}
        <div className="text-right flex-shrink-0">
          <div className="font-bold text-blue-600">
            {formatPrice(props.listingPrice)}
          </div>
          {props.discountEuros > 0 && (
            <div className="text-xs text-emerald-600">
              -{Math.round(props.discountPercent)}%
            </div>
          )}
        </div>

        {/* Deal Tier */}
        <div className="flex-shrink-0">
          {dealTier && <DealTierBadge tier={dealTier} size="sm" />}
        </div>

        {/* Score & Confidence (ML only) */}
        {dealScore !== null && confidence !== null && (
          <div className="hidden md:flex flex-shrink-0 items-center gap-3 text-xs">
            <span className="text-gray-500">
              Score: <span className="font-medium text-gray-900">{Math.round(dealScore)}</span>
            </span>
            <span className="text-gray-500">
              Conf: <span className="font-medium text-gray-900">{Math.round(confidence * 100)}%</span>
            </span>
          </div>
        )}

        {/* Source & Status */}
        <div className="hidden sm:flex flex-shrink-0 items-center gap-2">
          <Badge variant={getSourceColor(props.listing.source)} className="text-xs">
            {props.listing.source}
          </Badge>
          {!props.isAcknowledged && (
            <Badge variant="default" className="text-xs">Nieuw</Badge>
          )}
        </div>

        {/* Time & Link */}
        <div className="flex-shrink-0 flex items-center gap-2">
          <span className="hidden lg:inline text-xs text-gray-400">
            {formatDate(props.createdAt)}
          </span>
          <a
            href={props.listing.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </a>
        </div>
      </div>
    </Card>
  )
}

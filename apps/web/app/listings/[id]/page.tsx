"use client"

import { useState, useEffect } from "react"
import { ExternalLink, AlertTriangle, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DealTierBadge } from "@/components/deals/DealTierBadge"
import { ConfidenceMeter } from "@/components/deals/ConfidenceMeter"
import { PriceRangeBar } from "@/components/deals/PriceRangeBar"
import { DealScoreIndicator } from "@/components/deals/DealScoreIndicator"

interface MlPrediction {
  predictedP10: number
  predictedP50: number
  predictedP90: number
  suspicionFlag: boolean
  coverageLevel: number
  effectiveDealTier: string
}

interface NlpFeature {
  id: string
  type: string
  isPremium: boolean
  description: string
}

interface RdwData {
  cataloguePrice: number | null
  weight: number | null
  co2Emission: number | null
  euroClass: string | null
  apkExpiry: string | null
}

interface TaxData {
  rdwData: RdwData | null
}

interface Listing {
  id: string
  make: string
  model: string
  year: number | null
  mileage: number | null
  fuelType: string | null
  transmission: string | null
  city: string | null
  source: string
  url: string
  price: number
  createdAt: string
  dealTier: string | null
  dealScore: number | null
  confidence: number | null
  mlPrediction: MlPrediction | null
  nlpFeatures: NlpFeature[]
  taxData: TaxData | null
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("nl-NL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function formatMileage(mileage: number | null): string {
  if (mileage === null) return "-"
  return new Intl.NumberFormat("nl-NL").format(mileage) + " km"
}

interface PageProps {
  params: {
    id: string
  }
}

export default function ListingDetailPage({ params }: PageProps) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchListing()
  }, [params.id])

  async function fetchListing() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/listings/${params.id}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError("Listing niet gevonden")
        } else {
          setError("Fout bij het laden van listing")
        }
        return
      }

      const data = await res.json() as Listing
      setListing(data)
    } catch (err) {
      console.error(err)
      setError("Fout bij het laden van listing")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !listing) {
    return (
      <div className="p-6 max-w-4xl">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-800">{error || "Listing niet gevonden"}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { mlPrediction } = listing

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold">
              {listing.make} {listing.model}
            </h1>
            <p className="text-muted-foreground mt-2">
              {listing.year || "-"} • {formatMileage(listing.mileage)} •{" "}
              {listing.fuelType || "-"} • {listing.city || "-"}
            </p>
          </div>
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="default" className="flex items-center gap-2">
              Origineel
              <ExternalLink className="w-4 h-4" />
            </Button>
          </a>
        </div>
      </div>

      {/* Price Analysis Card */}
      {listing.dealTier && listing.dealScore !== null && listing.confidence !== null && mlPrediction ? (
        <Card className="mb-6 border-l-4 border-l-blue-500">
          <CardHeader>
            <CardTitle>Analyse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">
                  Deal Status
                </label>
                <DealTierBadge tier={listing.dealTier} size="lg" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">
                  Betrouwbaarheid
                </label>
                <ConfidenceMeter confidence={listing.confidence} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">
                  Score
                </label>
                <DealScoreIndicator
                  score={listing.dealScore}
                  suspicionFlag={mlPrediction.suspicionFlag}
                />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <label className="text-xs font-medium text-gray-600 block mb-3">
                Prijs Range
              </label>
              <PriceRangeBar
                predictedP10={mlPrediction.predictedP10}
                predictedP50={mlPrediction.predictedP50}
                predictedP90={mlPrediction.predictedP90}
                actualPrice={listing.price}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Price Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Prijs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold text-blue-600">
            {formatPrice(listing.price)}
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Geplaatst: {formatDate(listing.createdAt)}
          </p>
        </CardContent>
      </Card>

      {/* Vehicle Details Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Voertuiggegevens</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-medium text-gray-600">Jaar</label>
              <p className="text-lg font-medium">{listing.year || "-"}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">
                Kilometerstand
              </label>
              <p className="text-lg font-medium">
                {formatMileage(listing.mileage)}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">
                Brandstof
              </label>
              <p className="text-lg font-medium">{listing.fuelType || "-"}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">
                Transmissie
              </label>
              <p className="text-lg font-medium">
                {listing.transmission || "-"}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Plaats</label>
              <p className="text-lg font-medium">{listing.city || "-"}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Bron</label>
              <Badge variant="outline">{listing.source}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RDW Data Card */}
      {listing.taxData?.rdwData ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>RDW Gegevens</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {listing.taxData.rdwData.cataloguePrice && (
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Catalogusprijs
                  </label>
                  <p className="text-lg font-medium">
                    {formatPrice(listing.taxData.rdwData.cataloguePrice)}
                  </p>
                </div>
              )}
              {listing.taxData.rdwData.weight && (
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Gewicht
                  </label>
                  <p className="text-lg font-medium">
                    {listing.taxData.rdwData.weight} kg
                  </p>
                </div>
              )}
              {listing.taxData.rdwData.co2Emission && (
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    CO2 Uitstoot
                  </label>
                  <p className="text-lg font-medium">
                    {listing.taxData.rdwData.co2Emission} g/km
                  </p>
                </div>
              )}
              {listing.taxData.rdwData.euroClass && (
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Euro Klasse
                  </label>
                  <p className="text-lg font-medium">
                    {listing.taxData.rdwData.euroClass}
                  </p>
                </div>
              )}
              {listing.taxData.rdwData.apkExpiry && (
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    APK Vervalt
                  </label>
                  <p className="text-lg font-medium">
                    {formatDate(listing.taxData.rdwData.apkExpiry)}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* NLP Features Card */}
      {listing.nlpFeatures && listing.nlpFeatures.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aanvullende Informatie</CardTitle>
            <CardDescription>
              Gedetecteerd uit de advertentie
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {listing.nlpFeatures.map((feature) => (
                <div
                  key={feature.id}
                  className="flex items-start gap-3 p-3 bg-gray-50 rounded"
                >
                  {feature.isPremium ? (
                    <Badge variant="default" className="flex-shrink-0 mt-0.5">
                      Premium
                    </Badge>
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{feature.type}</p>
                    {feature.description && (
                      <p className="text-xs text-gray-600 mt-1">
                        {feature.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

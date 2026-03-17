interface PriceRangeBarProps {
  predictedP10: number
  predictedP50: number
  predictedP90: number
  actualPrice: number
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value)
}

export function PriceRangeBar({
  predictedP10,
  predictedP50,
  predictedP90,
  actualPrice,
}: PriceRangeBarProps) {
  const range = predictedP90 - predictedP10
  const p50Position = ((predictedP50 - predictedP10) / range) * 100
  const actualPosition = ((actualPrice - predictedP10) / range) * 100

  const isBelowMarket = actualPrice < predictedP50
  const savingsPercent = isBelowMarket
    ? ((predictedP50 - actualPrice) / predictedP50) * 100
    : 0

  return (
    <div className="space-y-2">
      <div className="relative h-6 bg-gray-100 rounded-sm overflow-hidden">
        {isBelowMarket && (
          <div
            className="absolute top-0 left-0 h-full bg-emerald-200"
            style={{ width: `${actualPosition}%` }}
          />
        )}

        <div
          className="absolute top-1/2 h-1 w-0.5 bg-gray-400 -translate-y-1/2 -translate-x-1/2"
          style={{ left: `${p50Position}%` }}
        />

        <div
          className="absolute top-1/2 w-3 h-3 bg-blue-600 rounded-full -translate-y-1/2 -translate-x-1/2 border-2 border-white shadow-sm"
          style={{ left: `${Math.min(actualPosition, 100)}%` }}
        />
      </div>

      <div className="flex justify-between items-start text-xs">
        <div className="text-gray-600">
          <div className="font-medium">{formatPrice(predictedP10)}</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-blue-600">
            {formatPrice(actualPrice)}
          </div>
          {isBelowMarket && (
            <div className="text-emerald-600 font-medium">
              -{savingsPercent.toFixed(0)}%
            </div>
          )}
        </div>
        <div className="text-gray-600 text-right">
          <div className="font-medium">{formatPrice(predictedP90)}</div>
        </div>
      </div>
    </div>
  )
}

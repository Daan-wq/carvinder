import { AlertTriangle } from "lucide-react"

interface DealScoreIndicatorProps {
  score: number
  suspicionFlag?: boolean
}

export function DealScoreIndicator({
  score,
  suspicionFlag = false,
}: DealScoreIndicatorProps) {
  let label = ""
  let color = ""

  if (score >= 1.5) {
    label = "Extreme deal"
    color = "text-emerald-600"
  } else if (score >= 1.0) {
    label = "Sterke deal"
    color = "text-emerald-600"
  } else if (score >= 0.5) {
    label = "Redelijk"
    color = "text-gray-600"
  } else if (score >= 0) {
    label = "Marktprijs"
    color = "text-gray-600"
  } else {
    label = "Boven markt"
    color = "text-orange-600"
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <div className={`text-lg font-bold ${color}`}>{score.toFixed(2)}</div>
        <div className="text-xs text-gray-600">{label}</div>
      </div>
      {suspicionFlag && (
        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-1" />
      )}
    </div>
  )
}

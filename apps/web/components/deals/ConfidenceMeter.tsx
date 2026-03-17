interface ConfidenceMeterProps {
  confidence: number
}

export function ConfidenceMeter({ confidence }: ConfidenceMeterProps) {
  const percentage = Math.round(confidence * 100)

  let bgColor = "bg-red-500"
  if (confidence >= 0.7) {
    bgColor = "bg-emerald-500"
  } else if (confidence >= 0.5) {
    bgColor = "bg-amber-500"
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full ${bgColor} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
        {percentage}%
      </span>
    </div>
  )
}

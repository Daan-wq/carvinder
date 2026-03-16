"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"

interface SearchProfile {
  id: string
  make: string
  model: string
  enabled: boolean
}

export default function SearchesPage() {
  const [searches, setSearches] = useState<SearchProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/searches").then(r => r.json() as Promise<{ searches?: SearchProfile[] }>).then(d => {
      setSearches(d.searches || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">Search Profiles</h1>
      <p className="text-muted-foreground mb-8">Manage car search configurations</p>
      
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {searches.length > 0 ? (
            searches.map((s) => (
              <Card key={s.id}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>{s.make} {s.model}</CardTitle>
                    <Badge>{s.enabled ? "Active" : "Inactive"}</Badge>
                  </div>
                </CardHeader>
              </Card>
            ))
          ) : (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No searches</CardContent></Card>
          )}
        </div>
      )}
    </div>
  )
}

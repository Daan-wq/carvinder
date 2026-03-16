"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, AlertCircle } from "lucide-react"

interface Notification {
  id: string
  type: string
  message: string
  dealCount: number
  success: boolean
  sentAt: string
  error: string | null
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/notifications?limit=50")
      .then(res => res.json())
      .then(data => setNotifications(data.data ?? []))
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-2">Notifications</h1>
      <p className="text-muted-foreground mb-8">Timeline of Telegram notifications</p>

      {loading ? (
        <div className="py-8 text-center text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-4">
          {notifications.length > 0 ? (
            notifications.map((n) => (
              <Card key={n.id}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div className="flex gap-3 flex-1">
                      {n.success ? (
                        <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                      )}
                      <div>
                        <CardTitle className="text-base">
                          {n.dealCount} deal{n.dealCount !== 1 ? "s" : ""} sent
                        </CardTitle>
                        <CardDescription className="mt-1 line-clamp-2">
                          {n.message.substring(0, 200)}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={n.success ? "default" : "destructive"}>
                      {n.success ? "Sent" : "Failed"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {new Date(n.sentAt).toLocaleString("nl-NL")}
                  {n.error && <span className="ml-2 text-red-500">{n.error}</span>}
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No notifications yet
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

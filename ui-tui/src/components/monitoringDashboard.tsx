import { Box, Text, useStdout } from 'ink'
import React, { useEffect, useState } from 'react'

interface MetricValue {
  value: number
  recorded_at: string
  tags?: Record<string, string>
}

interface MonitoringSummary {
  metric_names: string[]
  latest_values: Record<string, MetricValue>
  metric_count: number
  generated_at: string
}

export function MonitoringDashboard({ gw }: { gw: { request: (method: string, params?: unknown) => Promise<unknown> } }) {
  const { stdout } = useStdout()
  const [data, setData] = useState<MonitoringSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      try {
        const res = await gw.request('monitoring.summary', {})
        if (!cancelled) setData(res as MonitoringSummary)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [gw])

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Monitoring Dashboard Error</Text>
        <Text color="red">{error}</Text>
      </Box>
    )
  }

  if (!data) {
    return (
      <Box padding={1}>
        <Text>Loading monitoring data...</Text>
      </Box>
    )
  }

  const width = stdout.columns || 80
  const gatewayState = data.latest_values['gateway.state']
  const gatewayStateStr = gatewayState?.tags?.state ?? 'unknown'
  const activeAgents = data.latest_values['gateway.active_agents']?.value ?? 0
  const rssMb = data.latest_values['memory.rss_mb']?.value
  const diskPct = data.latest_values['disk.hermes_home_used_pct']?.value
  const cronTotal = data.latest_values['cron.jobs_total']?.value ?? 0
  const cronError = data.latest_values['cron.jobs_error']?.value ?? 0
  const platformErrors = data.latest_values['gateway.platforms_error']?.value ?? 0

  const stateColor = gatewayStateStr === 'running' ? 'green' : gatewayStateStr === 'offline' ? 'yellow' : 'red'
  const stateDot = gatewayStateStr === 'running' ? '\u25CF' : '\u25CB'

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text bold color="cyan">{'\u{1F4CA}'} Monitoring Dashboard</Text>
        <Text>  </Text>
        <Text color="gray">Updated: {formatAgo(data.generated_at)}</Text>
      </Box>
      <Box marginY={1}>
        <Text>{'\u2500'.repeat(Math.min(width - 2, 78))}</Text>
      </Box>
      <Box>
        <Text bold>Gateway: </Text>
        <Text color={stateColor}>{stateDot} {gatewayStateStr}</Text>
        <Text>  </Text>
        <Text>Agents: </Text>
        <Text bold>{activeAgents}</Text>
        <Text>  </Text>
        <Text>Platform Errors: </Text>
        <Text bold color={platformErrors > 0 ? 'red' : undefined}>{platformErrors}</Text>
      </Box>
      <Box>
        <Text bold>Memory RSS: </Text>
        <Text>{rssMb != null ? `${rssMb.toFixed(1)} MB` : 'N/A'}</Text>
        <Text>  </Text>
        <Text bold>Disk Usage: </Text>
        <Text>{diskPct != null ? `${diskPct.toFixed(1)}%` : 'N/A'}</Text>
      </Box>
      <Box>
        <Text bold>Cron Jobs: </Text>
        <Text>{cronTotal} total</Text>
        <Text>  </Text>
        {cronError > 0 && <Text color="red">{cronError} error(s)</Text>}
      </Box>
      <Box marginY={1}>
        <Text color="gray">Metrics: {data.metric_count} tracked</Text>
      </Box>
    </Box>
  )
}

function formatAgo(isoStr: string): string {
  try {
    const dt = new Date(isoStr)
    const now = Date.now()
    const secs = Math.floor((now - dt.getTime()) / 1000)
    if (secs < 0) return 'now'
    if (secs < 60) return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    return `${Math.floor(secs / 3600)}h ago`
  } catch {
    return isoStr
  }
}

export default MonitoringDashboard

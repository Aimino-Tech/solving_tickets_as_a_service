import { Box, Text, useInput } from '@hermes/ink'
import { useEffect, useState } from 'react'

import type { Theme } from './theme.js'

// ── Data types ──────────────────────────────────────────────────────

export interface PlatformStatus {
  connected: boolean
  error?: string
  lastActivity?: string
  state?: string
}

export interface GatewayData {
  activeAgents: number
  pid?: number
  state: string
  uptime?: string
}

export interface MemoryReading {
  label: string
  timestamp: number
  value: number
}

export interface CronStatus {
  errorCount: number
  jobs: { name?: string; schedule?: string }[]
  lastRun?: string
  totalJobs: number
}

export interface MonitoringData {
  cron: CronStatus
  gateway: GatewayData
  memory: MemoryReading[]
  platforms: Record<string, PlatformStatus>
  updatedAt: string
}

// ── Helpers ─────────────────────────────────────────────────────────

const BAR_MAX_WIDTH = 22
const BAR_CHAR = '\u2588'
const BAR_EMPTY = '\u2591'

function buildBar(value: number, max: number, width: number): string {
  const filled = Math.round((Math.min(value, max) / max) * width)
  return BAR_CHAR.repeat(filled) + BAR_EMPTY.repeat(width - filled)
}

function formatBytes(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`
  }
  return `${Math.round(mb)}MB`
}

// ── Color constants (design-system tokens) ──────────────────────────

const COLOR_OK = '#3fb950'
const COLOR_DISCONNECTED = '#8b949e'
const COLOR_ERROR = '#f85149'
const COLOR_HEADER = '#58a6ff'
const COLOR_VALUE = '#e6edf3'
const COLOR_DIM = '#6e7681'
const COLOR_ACCENT = '#79c0ff'

// ── Sub-components ──────────────────────────────────────────────────

function SectionDivider() {
  return (
    <Box>
      <Text color={COLOR_DIM}>{'\u2500'.repeat(45)}</Text>
    </Box>
  )
}

function GatewaySection({ gateway, t }: { gateway: GatewayData; t: Theme }) {
  const isRunning = gateway.state === 'running'
  const dotColor = isRunning ? COLOR_OK : gateway.state === 'error' ? COLOR_ERROR : COLOR_DISCONNECTED

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color={COLOR_HEADER}>
          Gateway:{' '}
        </Text>
        <Text color={dotColor}>{isRunning ? '\u25cf' : '\u25cb'}</Text>
        <Text color={COLOR_VALUE}> {gateway.state}</Text>
        {gateway.pid != null && (
          <Text color={COLOR_DIM}> (PID: {gateway.pid})</Text>
        )}
        <Text color={COLOR_DIM}>  {gateway.activeAgents} agent{gateway.activeAgents !== 1 ? 's' : ''}</Text>
      </Text>
      {gateway.uptime && (
        <Text>
          <Text color={COLOR_DIM}>Uptime: </Text>
          <Text color={COLOR_VALUE}>{gateway.uptime}</Text>
        </Text>
      )}
    </Box>
  )
}

function PlatformSection({ platforms }: { platforms: Record<string, PlatformStatus> }) {
  const entries = Object.entries(platforms)

  if (entries.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={COLOR_DIM}>No platforms configured</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold color={COLOR_HEADER}>
        Platforms:
      </Text>
      {entries.map(([name, info]) => {
        const dot = info.connected ? '\u25cf' : '\u25cb'
        const dotColor = info.connected ? COLOR_OK : COLOR_DISCONNECTED
        const statusText = info.connected ? 'connected' : 'disconnected'
        const errorSuffix = info.error ? `  error: ${info.error}` : ''
        const lastSuffix = info.lastActivity ? `  last: ${info.lastActivity}` : ''

        return (
          <Text key={name}>
            <Text color={COLOR_DIM}>  </Text>
            <Text color={COLOR_VALUE}>{name.padEnd(12)}</Text>
            <Text color={dotColor}>{dot}</Text>
            <Text color={info.connected ? COLOR_OK : COLOR_DISCONNECTED}> {statusText}</Text>
            <Text color={COLOR_DIM}>{errorSuffix || lastSuffix}</Text>
          </Text>
        )
      })}
    </Box>
  )
}

function MemorySection({ memory }: { memory: MemoryReading[] }) {
  if (memory.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={COLOR_DIM}>No memory data available</Text>
      </Box>
    )
  }

  const maxValue = Math.max(...memory.map(r => r.value))

  return (
    <Box flexDirection="column">
      <Text bold color={COLOR_HEADER}>
        Memory RSS (last {memory.length} readings):
      </Text>
      {memory.slice(-12).map((reading, index) => {
        const bar = buildBar(reading.value, maxValue * 1.1, BAR_MAX_WIDTH)
        return (
          <Text key={index}>
            <Text color={COLOR_ACCENT}>  {bar}</Text>
            <Text color={COLOR_DIM}> </Text>
            <Text color={COLOR_VALUE}>{formatBytes(reading.value)}</Text>
          </Text>
        )
      })}
    </Box>
  )
}

function CronSection({ cron }: { cron: CronStatus }) {
  const errorLabel = cron.errorCount > 0 ? ` (${cron.errorCount} error${cron.errorCount !== 1 ? 's' : ''})` : ''
  const errorColor = cron.errorCount > 0 ? COLOR_ERROR : COLOR_OK

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color={COLOR_HEADER}>
          Cron:{' '}
        </Text>
        <Text color={COLOR_VALUE}>{cron.totalJobs} job{cron.totalJobs !== 1 ? 's' : ''}</Text>
        <Text color={errorColor}>{errorLabel}</Text>
        {cron.lastRun && (
          <Text color={COLOR_DIM}>  Last: {cron.lastRun}</Text>
        )}
      </Text>
    </Box>
  )
}

// ── Loading state ───────────────────────────────────────────────────

function LoadingState() {
  return (
    <Box
      borderColor={COLOR_DIM}
      borderStyle="round"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={COLOR_HEADER}>
          Loading monitoring data...
        </Text>
      </Box>
      <Text color={COLOR_DIM}>Fetching gateway status, platform info, memory metrics, and cron jobs.</Text>
    </Box>
  )
}

// ── Main dashboard ──────────────────────────────────────────────────

export function MonitoringDashboard({ data, loading, onClose, t }: MonitoringDashboardProps) {
  const [lastUpdate, setLastUpdate] = useState(() => Date.now())

  // Refresh the "X seconds ago" display every 5 seconds
  useEffect(() => {
    const id = setInterval(() => setLastUpdate(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onClose()
    }
  })

  if (loading || !data) {
    return <LoadingState />
  }

  const ageSec = Math.round((Date.now() - lastUpdate) / 1000)
  const ageLabel = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`

  return (
    <Box
      borderColor={COLOR_DIM}
      borderStyle="round"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={COLOR_HEADER}>
          {'\u2588'}{'\u2591'}{'\u2592'} Monitoring Dashboard
        </Text>
      </Box>

      <SectionDivider />

      {/* Gateway status */}
      <Box marginTop={1}>
        <GatewaySection gateway={data.gateway} t={t} />
      </Box>

      <SectionDivider />

      {/* Platform status */}
      <Box marginTop={1}>
        <PlatformSection platforms={data.platforms} />
      </Box>

      <SectionDivider />

      {/* Memory RSS */}
      <Box marginTop={1}>
        <MemorySection memory={data.memory} />
      </Box>

      <SectionDivider />

      {/* Cron status */}
      <Box marginTop={1}>
        <CronSection cron={data.cron} />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={COLOR_DIM}>
          Updated: {ageLabel}  [q=quit]
        </Text>
      </Box>
    </Box>
  )
}

// ── Props ───────────────────────────────────────────────────────────

export interface MonitoringDashboardProps {
  data?: MonitoringData
  loading?: boolean
  onClose: () => void
  t: Theme
}

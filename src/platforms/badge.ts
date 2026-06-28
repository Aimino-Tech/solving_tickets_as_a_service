/**
 * Shields.io-compatible badge SVG generator.
 *
 * Produces dynamic SVG badges showing fix status (passed / failed / pending)
 * in the same flat style as shields.io, so they can be embedded in READMEs,
 * PR descriptions, or anywhere that accepts markdown images.
 *
 * Usage:
 *   const svg = renderBadgeSvg(statusToBadge('completed'));
 *
 * Compatible with shields.io endpoint format so users can create proxy
 * badges via https://img.shields.io/endpoint?url=...
 *
 * @module platforms/badge
 */

export interface BadgeConfig {
  label: string;
  message: string;
  color: string;
}

const STATUS_MAP: Record<string, BadgeConfig> = {
  completed: { label: 'fix', message: 'passed', color: 'success' },
  success: { label: 'fix', message: 'passed', color: 'success' },
  passed: { label: 'fix', message: 'passed', color: 'success' },
  failed: { label: 'fix', message: 'failed', color: 'critical' },
  running: { label: 'fix', message: 'pending', color: 'blue' },
  pending: { label: 'fix', message: 'pending', color: 'blue' },
  queued: { label: 'fix', message: 'queued', color: 'yellow' },
  cancelled: { label: 'fix', message: 'cancelled', color: 'inactive' },
};

const COLOR_MAP: Record<string, string> = {
  success: '#2ea44f',
  critical: '#d73a4a',
  blue: '#0969da',
  yellow: '#d4a72c',
  inactive: '#8b949e',
  lightgrey: '#9da0a2',
  green: '#2ea44f',
  red: '#d73a4a',
  orange: '#d96c24',
  purple: '#8250df',
};

export function statusToBadge(status: string): BadgeConfig {
  return STATUS_MAP[status] ?? { label: 'fix', message: status, color: 'lightgrey' };
}

export function renderBadgeSvg(config: BadgeConfig): string {
  const { label, message, color } = config;
  const hexColor = COLOR_MAP[color] || color;
  const labelWidth = Math.max(label.length * 7 + 14, 30);
  const msgWidth = Math.max(message.length * 7 + 14, 24);
  const totalWidth = labelWidth + msgWidth;
  const escapedLabel = escapeXml(label);
  const escapedMsg = escapeXml(message);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapedLabel}: ${escapedMsg}">
  <title>${escapedLabel}: ${escapedMsg}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${msgWidth}" height="20" fill="${hexColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.floor(labelWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${escapedLabel}</text>
    <text x="${Math.floor(labelWidth / 2)}" y="14">${escapedLabel}</text>
    <text x="${labelWidth + Math.floor(msgWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${escapedMsg}</text>
    <text x="${labelWidth + Math.floor(msgWidth / 2)}" y="14">${escapedMsg}</text>
  </g>
</svg>`;
}

export function badgeToJson(config: BadgeConfig): Record<string, unknown> {
  return {
    schemaVersion: 1,
    label: config.label,
    message: config.message,
    color: config.color,
  };
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

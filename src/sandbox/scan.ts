/**
 * Vulnerability scanning for Docker base images.
 *
 * Runs grype or trivy on the configured base image to detect
 * critical and high-severity CVEs before container creation.
 * Results are cached to avoid repeated scans of the same image.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'sandbox-scan' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanResult {
  image: string;
  scannedAt: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  passed: boolean;
  vulnerabilities: Vulnerability[];
}

export interface Vulnerability {
  id: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Negligible' | 'Unknown';
  package: string;
  installedVersion: string;
  fixedVersion: string;
  description?: string;
}

export interface ScanOptions {
  /** Force re-scan even if cached */
  force?: boolean;
  /** Fail only on critical (default) or also on high */
  failOn?: 'critical' | 'high';
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_DIR = join(tmpdir(), 'stas-scan-cache');

function getCacheKey(image: string): string {
  return createHash('sha256').update(image).digest('hex').slice(0, 16);
}

function getCachePath(image: string): string {
  return join(CACHE_DIR, `${getCacheKey(image)}.json`);
}

function readCache(image: string): ScanResult | null {
  const cachePath = getCachePath(image);
  if (!existsSync(cachePath)) return null;
  try {
    const data = readFileSync(cachePath, 'utf-8');
    return JSON.parse(data) as ScanResult;
  } catch (err) {
    log.warn({ err: String(err), cachePath }, 'Failed to read scan cache');
    return null;
  }
}

function writeCache(image: string, result: ScanResult): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(getCachePath(image), JSON.stringify(result, null, 2), 'utf-8');
    log.info({ image }, 'Scan result cached');
  } catch (err) {
    log.warn({ err: String(err) }, 'Failed to write scan cache');
  }
}

// ---------------------------------------------------------------------------
// Scanner detection
// ---------------------------------------------------------------------------

type Scanner = 'grype' | 'trivy' | null;

function detectScanner(): Scanner {
  try {
    execSync('grype version', { stdio: 'ignore', timeout: 10_000 });
    return 'grype';
  } catch {
    /* grype not found */
  }

  try {
    execSync('trivy --version', { stdio: 'ignore', timeout: 10_000 });
    return 'trivy';
  } catch {
    /* trivy not found */
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseGrypeOutput(json: string, image: string): ScanResult {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error(`Failed to parse grype JSON output: ${json.slice(0, 200)}`);
  }

  const matches = data.matches ?? [];
  const vulnerabilities: Vulnerability[] = [];
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const match of matches) {
    const vuln = match.vulnerability ?? {};
    const artifact = match.artifact ?? {};
    const severity = (vuln.severity ?? 'Unknown') as Vulnerability['severity'];

    vulnerabilities.push({
      id: vuln.id ?? 'unknown',
      severity,
      package: artifact.name ?? 'unknown',
      installedVersion: artifact.version ?? 'unknown',
      fixedVersion: vuln.fix?.versions?.[0] ?? 'N/A',
    });

    if (severity === 'Critical') critical++;
    else if (severity === 'High') high++;
    else if (severity === 'Medium') medium++;
    else if (severity === 'Low') low++;
  }

  return {
    image,
    scannedAt: new Date().toISOString(),
    critical,
    high,
    medium,
    low,
    total: vulnerabilities.length,
    passed: critical === 0,
    vulnerabilities,
  };
}

function parseTrivyOutput(json: string, image: string): ScanResult {
  let data: any[];
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error(`Failed to parse trivy JSON output: ${json.slice(0, 200)}`);
  }

  const vulnerabilities: Vulnerability[] = [];
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const result of data) {
    const vulns = result.Vulnerabilities ?? [];
    for (const vuln of vulns) {
      const severity = (vuln.Severity ?? 'Unknown') as Vulnerability['severity'];

      vulnerabilities.push({
        id: vuln.VulnerabilityID ?? 'unknown',
        severity,
        package: vuln.PkgName ?? 'unknown',
        installedVersion: vuln.InstalledVersion ?? 'unknown',
        fixedVersion: vuln.FixedVersion ?? 'N/A',
      });

      const sev = severity.toUpperCase();
      if (sev === 'CRITICAL') critical++;
      else if (sev === 'HIGH') high++;
      else if (sev === 'MEDIUM') medium++;
      else if (sev === 'LOW') low++;
    }
  }

  return {
    image,
    scannedAt: new Date().toISOString(),
    critical,
    high,
    medium,
    low,
    total: vulnerabilities.length,
    passed: critical === 0,
    vulnerabilities,
  };
}

// ---------------------------------------------------------------------------
// Scan functions
// ---------------------------------------------------------------------------

/**
 * Run a vulnerability scan on a Docker image.
 *
 * @param image - Docker image to scan (e.g. "node:22-alpine")
 * @param options - Scan options (force re-scan, fail threshold)
 * @returns ScanResult with vulnerability counts and pass/fail status
 */
export function scanImage(image: string, options: ScanOptions = {}): ScanResult {
  const { force = false, failOn = 'critical' } = options;

  if (!config.docker.imageScanEnabled) {
    log.info({ image }, 'Image scanning is disabled by config');
    return {
      image,
      scannedAt: new Date().toISOString(),
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
      passed: true,
      vulnerabilities: [],
    };
  }

  // Check cache
  if (!force) {
    const cached = readCache(image);
    if (cached) {
      log.info({ image }, 'Using cached scan result');
      return cached;
    }
  }

  // Detect scanner
  const scanner = detectScanner();
  if (!scanner) {
    log.warn('No vulnerability scanner found (grype or trivy). Install one to enable CVE scanning.');
    return {
      image,
      scannedAt: new Date().toISOString(),
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
      passed: true,
      vulnerabilities: [],
    };
  }

  log.info({ image, scanner }, 'Scanning image for vulnerabilities');

  let result: ScanResult;

  try {
    if (scanner === 'grype') {
      const output = execSync(`grype ${image} -o json`, {
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      result = parseGrypeOutput(output, image);
    } else {
      const output = execSync(`trivy image --format json --quiet ${image}`, {
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
      result = parseTrivyOutput(output, image);
    }
  } catch (err) {
    const msg = `Vulnerability scan failed for '${image}': ${String(err)}`;
    log.error({ err: String(err) }, msg);
    throw new Error(msg);
  }

  // Determine pass/fail
  if (failOn === 'critical') {
    result.passed = result.critical === 0;
  } else {
    result.passed = result.critical === 0 && result.high === 0;
  }

  // Cache
  writeCache(image, result);

  return result;
}

/**
 * Assert that a Docker image passes vulnerability scanning.
 * Returns the scan result. Throws on failure.
 *
 * @param image - Docker image to scan
 * @param options - Scan options
 * @returns The ScanResult if scan passed
 * @throws Error if scan fails or critical CVEs are found
 */
export function assertImageSafe(image: string, options: ScanOptions = {}): ScanResult {
  const result = scanImage(image, options);

  if (!result.passed) {
    const threshold = options.failOn ?? 'critical';
    const details = result.vulnerabilities
      .filter((v) => threshold === 'critical' ? v.severity === 'Critical' : (v.severity === 'Critical' || v.severity === 'High'))
      .slice(0, 20)
      .map((v) => `  - ${v.id} (${v.severity}): ${v.package} ${v.installedVersion} → ${v.fixedVersion}`)
      .join('\n');

    throw new Error(
      `Image '${image}' failed vulnerability scan: ${result.critical} critical, ${result.high} high CVEs\n` +
      `Top vulnerabilities:\n${details}\n` +
      `Consider switching to a more secure base image or pinning a specific digest.`,
    );
  }

  log.info({ image, critical: result.critical, high: result.high, total: result.total }, 'Image passed vulnerability scan');
  return result;
}

/**
 * Clear the scan result cache for a specific image, or all images.
 */
export function clearScanCache(image?: string): void {
  if (image) {
    const cachePath = getCachePath(image);
    if (existsSync(cachePath)) {
      try {
        rmSync(cachePath, { force: true });
        log.info({ image }, 'Scan cache cleared');
      } catch (err) {
        log.warn({ err: String(err) }, 'Failed to clear scan cache');
      }
    }
  } else {
    // Clear all cache
    try {
      const { rmSync } = require('node:fs');
      if (existsSync(CACHE_DIR)) {
        rmSync(CACHE_DIR, { recursive: true, force: true });
        mkdirSync(CACHE_DIR, { recursive: true });
        log.info('All scan caches cleared');
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to clear scan caches');
    }
  }
}

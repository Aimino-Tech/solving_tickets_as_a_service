import { access, constants } from 'node:fs/promises';
import { extname } from 'node:path';
import { LoadDataError, type LoadDataOptions, type LoadDataResult, type DataFormat } from './types.js';

declare module 'parquetjs' {
  export const ParquetReader: {
    openFile(path: string): Promise<{
      getCursor(): { next(): Promise<Record<string, unknown> | null> };
    }>;
  };
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_URL_SIZE = 50 * 1024 * 1024;
const URL_FETCH_TIMEOUT = 30_000;

function detectFormat(options: LoadDataOptions): DataFormat {
  if (options.format && options.format !== 'auto') return options.format;

  if (options.csv_data !== undefined) {
    const firstLine = options.csv_data.split('\n')[0] || '';
    if (firstLine.includes('\t')) return 'tsv';
    return 'csv';
  }

  if (options.file_path) {
    const ext = extname(options.file_path).toLowerCase();
    switch (ext) {
      case '.csv': return 'csv';
      case '.tsv': return 'tsv';
      case '.xlsx':
      case '.xls': return 'excel';
      case '.parquet':
      case '.pq': return 'parquet';
      case '.json':
      case '.jsonl':
      case '.ndjson': return 'json';
    }
  }

  if (options.url) {
    const urlPath = new URL(options.url).pathname;
    const ext = extname(urlPath).toLowerCase();
    switch (ext) {
      case '.csv': return 'csv';
      case '.tsv': return 'tsv';
      case '.xlsx':
      case '.xls': return 'excel';
      case '.parquet':
      case '.pq': return 'parquet';
      case '.json':
      case '.jsonl':
      case '.ndjson': return 'json';
    }
  }

  return 'csv';
}

function parseCSV(content: string, hasHeader: boolean, skipRows: number, maxRows: number): LoadDataResult {
  const lines = content.split('\n').filter((l, i) => {
    if (i < skipRows) return false;
    return l.trim().length > 0;
  });

  if (lines.length === 0) {
    throw new LoadDataError('Empty CSV data', 'EMPTY_DATA');
  }

  let columns: string[];
  let startIdx = 0;

  if (hasHeader) {
    columns = parseCSVLine(lines[0]);
    startIdx = 1;
  } else {
    columns = lines[0].split(',').map((_, i) => `column_${i + 1}`);
  }

  const dataLines = maxRows > 0 ? lines.slice(startIdx, startIdx + maxRows) : lines.slice(startIdx);
  const data = dataLines.map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    columns.forEach((col, i) => {
      row[col] = values[i] ?? '';
    });
    return row;
  });

  return {
    data,
    columns,
    rows: data.length,
    format: 'csv',
  };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());

  return result.map((v) => {
    if (v.startsWith('"') && v.endsWith('"')) {
      return v.slice(1, -1).replace(/""/g, '"');
    }
    return v;
  });
}

function parseTSV(content: string, hasHeader: boolean, skipRows: number, maxRows: number): LoadDataResult {
  const lines = content.split('\n').filter((l, i) => {
    if (i < skipRows) return false;
    return l.trim().length > 0;
  });

  if (lines.length === 0) {
    throw new LoadDataError('Empty TSV data', 'EMPTY_DATA');
  }

  let columns: string[];
  let startIdx = 0;

  if (hasHeader) {
    columns = lines[0].split('\t').map((c) => c.trim());
    startIdx = 1;
  } else {
    columns = lines[0].split('\t').map((_, i) => `column_${i + 1}`);
  }

  const dataLines = maxRows > 0 ? lines.slice(startIdx, startIdx + maxRows) : lines.slice(startIdx);
  const data = dataLines.map((line) => {
    const values = line.split('\t').map((c) => c.trim());
    const row: Record<string, string> = {};
    columns.forEach((col, i) => {
      row[col] = values[i] ?? '';
    });
    return row;
  });

  return { data, columns, rows: data.length, format: 'tsv' };
}

function parseJSON(content: string, hasHeader: boolean, _skipRows: number, maxRows: number): LoadDataResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    parsed = lines.map((l) => JSON.parse(l));
  }

  let records: Record<string, unknown>[];

  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const firstArray = Object.values(obj).find((v) => Array.isArray(v)) as Record<string, unknown>[];
    records = firstArray || [obj as Record<string, unknown>];
  } else {
    throw new LoadDataError('JSON data must be an array or object', 'INVALID_JSON');
  }

  if (maxRows > 0) {
    records = records.slice(0, maxRows);
  }

  const allKeys = new Set<string>();
  records.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const columns = Array.from(allKeys);

  const data = records.map((r) => {
    const row: Record<string, string> = {};
    columns.forEach((col) => {
      const val = r[col];
      row[col] = val === null || val === undefined ? '' : String(val);
    });
    return row;
  });

  return { data, columns, rows: data.length, format: 'json' };
}

async function parseExcel(filePath: string, sheetName: string | undefined, hasHeader: boolean, skipRows: number, maxRows: number): Promise<LoadDataResult> {
  const mod = await import('xlsx');
  const workbook = mod.readFile(filePath, { cellDates: true });
  const sheet = sheetName ? workbook.Sheets[sheetName] : workbook.Sheets[workbook.SheetNames[0]];
  const actualSheetName = sheetName || workbook.SheetNames[0] || '';

  if (!sheet) {
    throw new LoadDataError(`Sheet "${sheetName}" not found`, 'SHEET_NOT_FOUND');
  }

  const jsonData = mod.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: hasHeader ? undefined : 1,
    defval: '',
    range: skipRows,
  });

  let columns: string[];
  let data: Record<string, string>[];

  if (hasHeader) {
    columns = Object.keys(jsonData[0] || {});
    data = jsonData as Record<string, string>[];
  } else {
    columns = (jsonData[0] as unknown as string[] || []).map((_: string, i: number) => `column_${i + 1}`);
    data = jsonData.slice(1).map((row: unknown) => {
      const values = row as string[];
      const r: Record<string, string> = {};
      columns.forEach((col, i) => {
        r[col] = values[i] ?? '';
      });
      return r;
    });
  }

  if (maxRows > 0) {
    data = data.slice(0, maxRows);
  }

  return {
    data,
    columns,
    rows: data.length,
    format: 'excel',
    sheet_name: actualSheetName,
  };
}

async function parseParquet(filePath: string, _hasHeader: boolean, _skipRows: number, maxRows: number): Promise<LoadDataResult> {
  const mod = await import('parquetjs');
  const reader = await mod.ParquetReader.openFile(filePath);
  const cursor = reader.getCursor();
  const records: Record<string, string>[] = [];
  let record: Record<string, unknown> | null;

  while ((record = await cursor.next()) && (maxRows <= 0 || records.length < maxRows)) {
    const row: Record<string, string> = {};
    for (const [key, val] of Object.entries(record)) {
      row[key] = val === null || val === undefined ? '' : String(val);
    }
    records.push(row);
  }

  await reader.close();

  if (records.length === 0) {
    throw new LoadDataError('Empty Parquet file', 'EMPTY_DATA');
  }

  const columns = Object.keys(records[0]);
  return { data: records, columns, rows: records.length, format: 'parquet' };
}

async function fetchFromURL(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TabICL-DataLoader/1.0' },
    });

    if (!response.ok) {
      throw new LoadDataError(`URL fetch failed: ${response.status} ${response.statusText}`, 'FETCH_ERROR');
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_URL_SIZE) {
      throw new LoadDataError(
        `URL content exceeds ${MAX_URL_SIZE / 1024 / 1024}MB limit`,
        'SIZE_EXCEEDED',
      );
    }

    const text = await response.text();
    if (text.length > MAX_URL_SIZE) {
      throw new LoadDataError(
        `URL content exceeds ${MAX_URL_SIZE / 1024 / 1024}MB limit`,
        'SIZE_EXCEEDED',
      );
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveFilePath(filePath: string): Promise<string> {
  const resolved = filePath.startsWith('/') ? filePath : `${process.cwd()}/${filePath}`;
  try {
    await access(resolved, constants.R_OK);
  } catch {
    throw new LoadDataError(`File not found or not readable: ${filePath}`, 'FILE_NOT_FOUND');
  }
  return resolved;
}

export async function loadData(options: LoadDataOptions): Promise<LoadDataResult> {
  const format = detectFormat(options);
  const hasHeader = options.has_header ?? true;
  const skipRows = options.skip_rows ?? 0;
  const maxRows = options.max_rows ?? 0;

  if (options.url) {
    const content = await fetchFromURL(options.url);
    switch (format) {
      case 'csv': return parseCSV(content, hasHeader, skipRows, maxRows);
      case 'tsv': return parseTSV(content, hasHeader, skipRows, maxRows);
      case 'json': return parseJSON(content, hasHeader, skipRows, maxRows);
      default: return parseCSV(content, hasHeader, skipRows, maxRows);
    }
  }

  if (options.file_path) {
    const resolvedPath = await resolveFilePath(options.file_path);
    if (format === 'excel') {
      return parseExcel(resolvedPath, options.sheet_name, hasHeader, skipRows, maxRows);
    }
    if (format === 'parquet') {
      return parseParquet(resolvedPath, hasHeader, skipRows, maxRows);
    }
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(resolvedPath, options.encoding as BufferEncoding || 'utf-8');
    switch (format) {
      case 'csv': return parseCSV(content, hasHeader, skipRows, maxRows);
      case 'tsv': return parseTSV(content, hasHeader, skipRows, maxRows);
      case 'json': return parseJSON(content, hasHeader, skipRows, maxRows);
      default: return parseCSV(content, hasHeader, skipRows, maxRows);
    }
  }

  if (options.csv_data !== undefined) {
    switch (format) {
      case 'csv': return parseCSV(options.csv_data, hasHeader, skipRows, maxRows);
      case 'tsv': return parseTSV(options.csv_data, hasHeader, skipRows, maxRows);
      case 'json': return parseJSON(options.csv_data, hasHeader, skipRows, maxRows);
      default: return parseCSV(options.csv_data, hasHeader, skipRows, maxRows);
    }
  }

  throw new LoadDataError(
    'One of csv_data, file_path, or url is required',
    'INVALID_INPUT',
  );
}

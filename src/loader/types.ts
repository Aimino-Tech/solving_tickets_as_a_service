export type DataFormat = 'csv' | 'tsv' | 'excel' | 'parquet' | 'json' | 'auto';

export interface LoadDataOptions {
  csv_data?: string;
  file_path?: string;
  url?: string;
  format?: DataFormat;
  sheet_name?: string;
  has_header?: boolean;
  encoding?: string;
  skip_rows?: number;
  max_rows?: number;
}

export interface LoadDataResult {
  data: Record<string, string>[];
  columns: string[];
  rows: number;
  format: DataFormat;
  sheet_name?: string;
  file_name?: string;
  warnings?: string[];
}

export class LoadDataError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'LoadDataError';
  }
}

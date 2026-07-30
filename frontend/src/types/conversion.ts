export interface ConversionWarning {
  image_index: number;
  measure_index: number | null;
  message: string;
}

export interface ConversionResult {
  job_id: string;
  measure_count: number;
  note_count: number;
  warning_count: number;
  warnings: ConversionWarning[];
  download_url: string;
}

export interface SelectedImage {
  id: string;
  file: File;
  previewUrl: string;
}


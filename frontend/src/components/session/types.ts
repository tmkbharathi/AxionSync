export interface FileMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
  s3Key: string;
  previewUrl?: string;
}

export interface DeviceInfo {
  name: string;
  platform: string;
  browser: string;
}

export interface ActiveDevice {
  id: string;
  info: DeviceInfo;
}

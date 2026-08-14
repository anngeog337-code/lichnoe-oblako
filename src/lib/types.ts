export type ResourceKind = "file" | "folder";

export type DriveResource = {
  id: string;
  kind: ResourceKind;
  name: string;
  ownerId: string;
  ownerName?: string | null;
  folderId: string | null;
  mimeType: string | null;
  extension: string | null;
  sizeBytes: number;
  status: string;
  isFavorite: boolean;
  isShared: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Usage = {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
};

export type UploadInitResponse = {
  uploadId: string;
  fileId: string;
  partSize: number;
  partCount: number;
};

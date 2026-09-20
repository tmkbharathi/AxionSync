import axios, { AxiosError } from "axios";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Environment variable resolution for backend API
const API_URL = (
  process.env.BACKEND_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://syncosync.onrender.com"
).replace(/\/$/, "");

export interface SessionPermissions {
  allowText: boolean;
  allowFiles: boolean;
  allowUploads: boolean;
}

export interface SessionFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: number;
  s3Key: string;
  hash: string;
  previewUrl?: string;
  previewUrlExpiresAt?: number;
}

export interface SessionDetails {
  sessionId: string;
  text: string;
  files: SessionFile[];
  permissions: SessionPermissions;
  guestRemainingSeconds?: number | null;
  guestExpiresAt?: number | null;
}

export interface UnlockResult {
  success: boolean;
  token: string;
  isMasterAdmin: boolean;
  permissions: SessionPermissions;
  expiresAt?: number;
  remainingSeconds?: number;
}

export interface GuestPasscode {
  passcode: string;
  label?: string;
  createdAt: number;
  expiresAt: number;
  durationSeconds: number;
  maxUses: number | null;
  uses: number;
  permissions: SessionPermissions;
  remainingSeconds?: number;
}

export interface ServiceError {
  code: string;
  message: string;
  status?: number;
}

export function formatServiceError(error: unknown): ServiceError {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<{ error?: string; message?: string }>;
    const status = axiosErr.response?.status;
    const serverMessage = axiosErr.response?.data?.error || axiosErr.response?.data?.message;

    if (status === 401) {
      return {
        code: "UNAUTHORIZED",
        message: serverMessage || "Unauthorized. Passcode or valid session token required.",
        status: 401,
      };
    }
    if (status === 403) {
      return {
        code: "FORBIDDEN",
        message: serverMessage || "Forbidden. Operation not permitted by session permissions.",
        status: 403,
      };
    }
    if (status === 404) {
      return {
        code: "NOT_FOUND",
        message: serverMessage || "Session or requested resource not found or expired.",
        status: 404,
      };
    }
    if (status === 409) {
      return {
        code: "CONFLICT",
        message: serverMessage || "Resource conflict or duplicate file.",
        status: 409,
      };
    }
    if (status === 400) {
      return {
        code: "INVALID_REQUEST",
        message: serverMessage || "Invalid request parameters.",
        status: 400,
      };
    }
    return {
      code: "BACKEND_ERROR",
      message: serverMessage || `Backend service error (${status || "unknown"}).`,
      status: status || 500,
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
      status: 500,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unknown error occurred while communicating with AxionSync backend.",
    status: 500,
  };
}

function getAuthHeaders(token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }
  return headers;
}

// 1. Get Session Details
export async function getSessionDetails(
  sessionId: string,
  token?: string
): Promise<SessionDetails> {
  const response = await axios.get(`${API_URL}/session/${encodeURIComponent(sessionId)}`, {
    headers: getAuthHeaders(token),
  });

  return {
    sessionId,
    text: response.data.text ?? "",
    files: Array.isArray(response.data.files) ? response.data.files : [],
    permissions: response.data.permissions || { allowText: true, allowFiles: true, allowUploads: true },
    guestRemainingSeconds: response.data.guestRemainingSeconds,
    guestExpiresAt: response.data.guestExpiresAt,
  };
}

// 2. Update Session Clipboard Text
export async function updateSessionText(
  sessionId: string,
  content: string,
  token?: string
): Promise<{ success: boolean; text: string }> {
  const response = await axios.put(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/text`,
    { content },
    { headers: getAuthHeaders(token) }
  );
  return { success: true, text: response.data.text };
}

// 3. Append to Session Clipboard Text
export async function appendSessionText(
  sessionId: string,
  content: string,
  token?: string,
  addNewline = true
): Promise<{ success: boolean; text: string }> {
  const current = await getSessionDetails(sessionId, token);
  const currentText = current.text;
  let newText = "";
  if (!currentText) {
    newText = content;
  } else if (addNewline) {
    newText = currentText.endsWith("\n") ? `${currentText}${content}` : `${currentText}\n${content}`;
  } else {
    newText = `${currentText}${content}`;
  }

  return updateSessionText(sessionId, newText, token);
}

// 4. Clear Session Clipboard Text
export async function clearSessionText(
  sessionId: string,
  token?: string
): Promise<{ success: boolean; text: string }> {
  return updateSessionText(sessionId, "", token);
}

// 5. List Session Files
export async function listSessionFiles(
  sessionId: string,
  token?: string
): Promise<{ files: SessionFile[]; count: number }> {
  const details = await getSessionDetails(sessionId, token);
  return {
    files: details.files,
    count: details.files.length,
  };
}

// 6. Get Secure File Download URL (verifies file ownership in session)
export async function getFileDownloadUrl(
  sessionId: string,
  fileId: string,
  token?: string
): Promise<{ downloadUrl: string; fileName: string; size: number; mimeType: string }> {
  const details = await getSessionDetails(sessionId, token);
  const targetFile = details.files.find((f) => f.id === fileId);

  if (!targetFile) {
    throw new Error(`File with ID '${fileId}' not found in session '${sessionId}'.`);
  }

  if (!targetFile.s3Key || !targetFile.s3Key.startsWith(`${sessionId}/`)) {
    throw new Error("Invalid file storage key structure.");
  }

  const response = await axios.get(
    `${API_URL}/download?s3Key=${encodeURIComponent(targetFile.s3Key)}`,
    { headers: getAuthHeaders(token) }
  );

  return {
    downloadUrl: response.data.url,
    fileName: targetFile.name,
    size: targetFile.size,
    mimeType: targetFile.mimeType,
  };
}

// 7. Upload Text / Code / Markdown File
export async function uploadTextFile(
  sessionId: string,
  fileName: string,
  content: string,
  mimeType = "text/plain",
  token?: string
): Promise<{ success: boolean; file: SessionFile }> {
  // Validate path traversal
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    throw new Error("Invalid fileName: path traversal characters are not allowed.");
  }

  const response = await axios.post(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/upload/raw`,
    { fileName, content, mimeType },
    { headers: getAuthHeaders(token) }
  );

  return {
    success: true,
    file: response.data.file,
  };
}

// 7b. Upload Local Binary / Any File (PDF, Images, Audio, Zip, Docs, etc.)
export async function uploadLocalFile(
  sessionId: string,
  filePath: string,
  token?: string
): Promise<{ success: boolean; file: SessionFile }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const fileSize = fileBuffer.length;
  const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  let mimeType = "application/octet-stream";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") mimeType = "application/pdf";
  else if (ext === ".png") mimeType = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
  else if (ext === ".webp") mimeType = "image/webp";
  else if (ext === ".gif") mimeType = "image/gif";
  else if (ext === ".mp4") mimeType = "video/mp4";
  else if (ext === ".zip") mimeType = "application/zip";
  else if (ext === ".json") mimeType = "application/json";
  else if (ext === ".txt" || ext === ".md") mimeType = "text/plain";

  // 1. Presign
  const presignRes = await axios.post(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/upload/presign`,
    {
      fileName,
      fileSize,
      mimeType: "application/octet-stream",
    },
    { headers: getAuthHeaders(token) }
  );

  const { uploadUrl, fileId, s3Key } = presignRes.data;

  // 2. PUT directly to S3/R2 storage
  await axios.put(uploadUrl, fileBuffer, {
    headers: {
      "Content-Type": "application/octet-stream",
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  // 3. Confirm upload
  const confirmRes = await axios.post(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/upload/confirm`,
    {
      fileId,
      name: fileName,
      size: fileSize,
      mimeType,
      s3Key,
      hash,
    },
    { headers: getAuthHeaders(token) }
  );

  return {
    success: true,
    file: confirmRes.data,
  };
}

// 8. Delete Session File
export async function deleteSessionFile(
  sessionId: string,
  fileId: string,
  token?: string
): Promise<{ success: boolean; fileId: string }> {
  const response = await axios.delete(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}`,
    { headers: getAuthHeaders(token) }
  );

  return {
    success: true,
    fileId: response.data.fileId || fileId,
  };
}

// 9. Unlock Protected / Admin Session
export async function unlockSession(
  sessionId: string,
  password: string
): Promise<UnlockResult> {
  const response = await axios.post(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/unlock`,
    { password }
  );

  return {
    success: true,
    token: response.data.token,
    isMasterAdmin: !!response.data.isMasterAdmin,
    permissions: response.data.permissions || { allowText: true, allowFiles: true, allowUploads: true },
    expiresAt: response.data.expiresAt,
    remainingSeconds: response.data.remainingSeconds,
  };
}

// 10. Create Share Guest Passcode (Master Admin only)
export async function createGuestPasscode(
  sessionId: string,
  options: {
    durationSeconds?: number;
    passcode?: string;
    maxUses?: number;
    label?: string;
    permissions?: Partial<SessionPermissions>;
  },
  token: string
): Promise<{ success: boolean; passcode: GuestPasscode }> {
  const response = await axios.post(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/share/create-passcode`,
    options,
    { headers: getAuthHeaders(token) }
  );

  return {
    success: true,
    passcode: response.data.passcode,
  };
}

// 11. List Guest Passcodes (Master Admin only)
export async function listGuestPasscodes(
  sessionId: string,
  token: string
): Promise<{ passcodes: GuestPasscode[] }> {
  const response = await axios.get(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/share/passcodes`,
    { headers: getAuthHeaders(token) }
  );

  return {
    passcodes: Array.isArray(response.data.passcodes) ? response.data.passcodes : [],
  };
}

// 12. Revoke Guest Passcode (Master Admin only)
export async function revokeGuestPasscode(
  sessionId: string,
  code: string,
  token: string
): Promise<{ success: boolean; code: string }> {
  const response = await axios.delete(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/share/passcodes/${encodeURIComponent(code)}`,
    { headers: getAuthHeaders(token) }
  );

  return {
    success: true,
    code: response.data.code || code,
  };
}

// 13. Update Guest Passcode Permissions (Master Admin only)
export async function updateGuestPasscodePermissions(
  sessionId: string,
  code: string,
  permissions: Partial<SessionPermissions>,
  token: string
): Promise<{ success: boolean; code: string; permissions: SessionPermissions }> {
  const response = await axios.patch(
    `${API_URL}/session/${encodeURIComponent(sessionId)}/share/passcodes/${encodeURIComponent(code)}/permissions`,
    { permissions },
    { headers: getAuthHeaders(token) }
  );

  return {
    success: true,
    code: response.data.code || code,
    permissions: response.data.permissions,
  };
}

// 14. Delete Entire Session
export async function deleteSession(
  sessionId: string,
  token?: string
): Promise<{ success: boolean; sessionId: string }> {
  await axios.delete(
    `${API_URL}/session/${encodeURIComponent(sessionId)}`,
    { headers: getAuthHeaders(token) }
  );

  return {
    success: true,
    sessionId,
  };
}

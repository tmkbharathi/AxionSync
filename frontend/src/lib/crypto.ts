// E2EE Cryptographic Utility using Native Web Crypto API (AES-256-GCM)

const PREFIX = "e2ee:v1:";
const FILE_MAGIC = new TextEncoder().encode("SYNC_E2EE_V1_KEY"); // 16 bytes marker

/**
 * Derives a 256-bit AES-GCM CryptoKey from secret key/sessionId using PBKDF2
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const salt = encoder.encode("syncosync:salt:" + secret);

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts plaintext into E2EE payload string (e2ee:v1:IV:CIPHERTEXT)
 */
export async function encryptText(plainText: string, secretKey: string): Promise<string> {
  if (!plainText || typeof window === "undefined" || !window.crypto?.subtle) {
    return plainText;
  }

  try {
    const key = await deriveKey(secretKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encodedText = encoder.encode(plainText);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encodedText
    );

    const ivBase64 = btoa(String.fromCharCode(...iv));
    const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));

    return `${PREFIX}${ivBase64}:${ciphertextBase64}`;
  } catch (err) {
    console.error("E2EE text encryption error:", err);
    return plainText;
  }
}

/**
 * Decrypts E2EE payload into plaintext with fallback for unencrypted legacy content
 */
export async function decryptText(payload: string, secretKey: string): Promise<string> {
  if (!payload || typeof window === "undefined" || !window.crypto?.subtle) {
    return payload;
  }

  if (!payload.startsWith(PREFIX)) {
    return payload;
  }

  try {
    const parts = payload.slice(PREFIX.length).split(":");
    if (parts.length !== 2) return payload;

    const [ivBase64, ciphertextBase64] = parts;
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));

    const key = await deriveKey(secretKey);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err) {
    console.error("E2EE text decryption error:", err);
    return payload;
  }
}

async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    try {
      return await blob.arrayBuffer();
    } catch (e) {
      // Fallback to FileReader if arrayBuffer() throws
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Encrypts a Blob/File with AES-256-GCM into an E2EE Blob: [16-byte magic][12-byte IV][Ciphertext]
 */
export async function encryptFile(file: Blob, secretKey: string): Promise<Blob> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return file;
  }

  try {
    const key = await deriveKey(secretKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const arrayBuffer = await readBlobAsArrayBuffer(file);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      arrayBuffer
    );

    const combined = new Uint8Array(FILE_MAGIC.length + iv.length + ciphertextBuffer.byteLength);
    combined.set(FILE_MAGIC, 0);
    combined.set(iv, FILE_MAGIC.length);
    combined.set(new Uint8Array(ciphertextBuffer), FILE_MAGIC.length + iv.length);

    return new Blob([combined], { type: "application/octet-stream" });
  } catch (err) {
    console.error("E2EE file encryption error:", err);
    return file;
  }
}

/**
 * Decrypts an E2EE encrypted Blob back to original Blob with mime type. Fallback if not encrypted.
 */
export async function decryptFile(encryptedBlob: Blob, secretKey: string, originalMimeType?: string): Promise<Blob> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return encryptedBlob;
  }

  try {
    const arrayBuffer = await readBlobAsArrayBuffer(encryptedBlob);
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length < FILE_MAGIC.length + 12) {
      return encryptedBlob;
    }

    let isEncrypted = true;
    for (let i = 0; i < FILE_MAGIC.length; i++) {
      if (bytes[i] !== FILE_MAGIC[i]) {
        isEncrypted = false;
        break;
      }
    }

    if (!isEncrypted) {
      return encryptedBlob; // Legacy unencrypted file
    }

    const iv = bytes.subarray(FILE_MAGIC.length, FILE_MAGIC.length + 12);
    const ciphertext = bytes.subarray(FILE_MAGIC.length + 12);

    const key = await deriveKey(secretKey);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return new Blob([decryptedBuffer], { type: originalMimeType || "application/octet-stream" });
  } catch (err) {
    console.error("E2EE file decryption error:", err);
    return encryptedBlob;
  }
}


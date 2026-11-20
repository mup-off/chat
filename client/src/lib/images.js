import { API_BASE } from './api.js';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 1600;

/** Stable URL for a stored image; the server checks access and redirects to storage. */
export const mediaUrl = (key) => `${API_BASE}/api/media/${key}`;

/** Returns an error message, or null if the file can be sent. */
export function checkImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) return 'Only JPEG, PNG, WebP or GIF images can be sent.';
  if (file.size > MAX_IMAGE_BYTES * 3) return 'That image is too large.';
  return null;
}

/**
 * Downscale to at most 1600 px and re-encode as WebP to save bandwidth.
 * GIFs are kept as-is (re-encoding would drop the animation).
 */
export async function compressImage(file) {
  if (file.type === 'image/gif') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // can't decode in this browser: send the original
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  // Some browsers can't encode WebP (they return PNG or null); keep whichever is smaller.
  if (!blob || !IMAGE_TYPES.includes(blob.type)) return file;
  return blob.size < file.size || scale < 1 ? blob : file;
}

/** Centre-crop to a square and resize to 512 px for a profile photo (WebP, else JPEG). */
export async function squareAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(512, side);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas
    .getContext('2d')
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  const webp = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
  if (webp?.type === 'image/webp') return webp;
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
}

// ------------------------------------------------------------- documents

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
// Must match the server whitelist. Type comes from the extension, because browsers
// report inconsistent types (e.g. Windows says .csv is application/vnd.ms-excel).
const DOCUMENT_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
};
export const DOCUMENT_ACCEPT = Object.keys(DOCUMENT_TYPES).map((e) => `.${e}`).join(',');

export const fileExtension = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** { contentType } if the file can be sent as a document, else { error }. */
export function checkDocument(file) {
  const contentType = DOCUMENT_TYPES[fileExtension(file.name)];
  if (!contentType) {
    return { error: 'This file type can’t be sent. Try PDF, Word, Excel, PowerPoint, text, CSV or ZIP.' };
  }
  if (file.size > MAX_DOCUMENT_BYTES) return { error: 'Documents can be up to 25 MB.' };
  if (file.size === 0) return { error: 'That file is empty.' };
  return { contentType };
}

/** "1.4 MB" */
export function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** PUT a blob to a presigned URL, reporting progress 0..1. */
export function uploadWithProgress(url, blob, onProgress, contentType = blob.type) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed')));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.send(blob);
  });
}

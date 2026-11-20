import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
// Whitelist: common office/text/archive formats. No HTML, SVG, scripts or executables.
export const DOCUMENT_TYPES = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
};

export const UPLOAD_KINDS = {
  image: { types: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES },
  document: { types: DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES },
};

/** RFC 6266 Content-Disposition that always downloads, with a UTF-8 file name. */
export function attachmentDisposition(fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const s3 = config.storage
  ? new S3Client({
      region: config.storage.region,
      endpoint: config.storage.endpoint,
      forcePathStyle: true, // required by MinIO/RustFS, works with R2 and S3
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
      // Don't add checksum headers to presigned PUTs; browsers wouldn't send them.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  : null;

const Bucket = config.storage?.bucket;

export const storageEnabled = () => s3 !== null;

/** Short-lived URL the browser PUTs the file to directly. */
export function presignUpload(key, contentType) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
    expiresIn: 300,
  });
}

/**
 * Short-lived URL to read a private object. Documents are forced to download
 * (never rendered by the browser) under their original file name.
 */
export function presignDownload(key, { downloadAs } = {}) {
  const command = new GetObjectCommand({
    Bucket,
    Key: key,
    ...(downloadAs && { ResponseContentDisposition: attachmentDisposition(downloadAs) }),
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

/** { size, contentType } of an uploaded object, or null if it doesn't exist. */
export async function headObject(key) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { size: r.ContentLength, contentType: r.ContentType };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** Server-side copy (used when forwarding a file into another conversation). */
export async function copyObject(fromKey, toKey) {
  await s3.send(new CopyObjectCommand({ Bucket, CopySource: `${Bucket}/${fromKey}`, Key: toKey }));
}

export async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key })).catch(() => {});
}

/** Browsers upload directly to the bucket, so it must allow the frontend origin. */
export async function setBucketCors(origins) {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          { AllowedOrigins: origins, AllowedMethods: ['PUT', 'GET'], AllowedHeaders: ['*'], MaxAgeSeconds: 3600 },
        ],
      },
    }),
  );
}

/** Dev convenience: create the bucket if it doesn't exist. */
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    return false;
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket }));
    return true;
  }
}

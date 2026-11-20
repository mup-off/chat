// Creates the media bucket if needed and allows browser uploads from CLIENT_ORIGIN.
import { ensureBucket, setBucketCors, storageEnabled } from '../src/storage.js';
import { config } from '../src/config.js';

if (!storageEnabled()) {
  console.log('S3_BUCKET not set: image sharing disabled, nothing to do.');
} else {
  const created = await ensureBucket();
  await setBucketCors([config.clientOrigin]);
  console.log(
    `Bucket ${config.storage.bucket} ${created ? 'created' : 'already exists'}; CORS allows ${config.clientOrigin}`,
  );
}

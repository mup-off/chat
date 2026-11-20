function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  isProd,
  // Max failed auth attempts per IP per 15 minutes.
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 10),
  // Behind one proxy hop in production (Railway/Render/Fly); Vite proxy on loopback in dev.
  trustProxy: isProd ? 1 : 'loopback',
  // How long a user stays "online" after their last tab disconnects (covers page reloads).
  presenceGraceMs: Number(process.env.PRESENCE_GRACE_MS ?? 3000),
  // S3-compatible storage for images. Image sharing is disabled if S3_BUCKET is unset.
  storage: process.env.S3_BUCKET
    ? {
        bucket: process.env.S3_BUCKET,
        endpoint: process.env.S3_ENDPOINT || undefined, // unset = AWS S3
        region: process.env.S3_REGION ?? 'auto',
        accessKeyId: required('S3_ACCESS_KEY_ID'),
        secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
      }
    : null,
};

import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse `data` with a zod schema or throw a 400 with the first issue. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    throw badRequest(field ? `${field}: ${issue.message}` : issue.message);
  }
  return result.data;
}

export const schemas = {
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,30}$/, '3–30 characters: letters, numbers, underscore'),
  // bcrypt only uses the first 72 bytes, so cap length.
  password: z.string().min(8, 'At least 8 characters').max(72, 'At most 72 characters'),
  displayName: z.string().trim().min(1, 'Required').max(60),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +250780000000'),
  uuid: z.uuid(),
};

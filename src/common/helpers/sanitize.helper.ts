/**
 * Helpers that make sure sensitive columns never leave the API.
 */

/** Shop columns that only the owner and admins may see (KYC / tax data). */
export const PRIVATE_SHOP_FIELDS = ['gstNumber', 'verificationDocuments'];

/** User columns that must never appear in any API response. */
export const SECRET_USER_FIELDS = [
  'password',
  'resetCode',
  'resetCodeExpiresAt',
  'resetAttempts',
];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' &&
  v !== null &&
  (Object.getPrototypeOf(v) === Object.prototype ||
    Object.getPrototypeOf(v) === null);

/** Returns a shallow copy of `shop` without owner/admin-only fields. */
export function omitPrivateShopFields<T extends object>(shop: T): T {
  const copy: Record<string, unknown> = { ...(shop as any) };
  for (const key of PRIVATE_SHOP_FIELDS) delete copy[key];
  return copy as T;
}

/**
 * Walks a query result and strips owner/admin-only fields from every nested
 * object stored under a `shop` key. Use for responses that are visible to
 * customers or influencers (never for the shop owner's or admin's own views).
 */
export function scrubNestedShops<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => scrubNestedShops(item));
    return value;
  }
  if (!isPlainObject(value)) return value;

  for (const [key, child] of Object.entries(value)) {
    if (key === 'shop' && isPlainObject(child)) {
      for (const field of PRIVATE_SHOP_FIELDS) delete child[field];
    }
    scrubNestedShops(child);
  }
  return value;
}

/** Recursively removes secret user columns from any response payload. */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => stripSecrets(item));
    return value;
  }
  if (!isPlainObject(value)) return value;

  for (const field of SECRET_USER_FIELDS) {
    if (field in value) delete value[field];
  }
  for (const child of Object.values(value)) stripSecrets(child);
  return value;
}

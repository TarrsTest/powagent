import { authenticate, hasScope, type AuthedKey, type OwnerType } from '@/lib/apikey';
import { err } from '@/lib/http';

/**
 * Route guard: authenticate the API key and assert owner type + scope.
 * Returns the AuthedKey on success, or a ready-to-return error Response.
 * This is the single choke point that keeps candidate ↔ org scopes isolated.
 */
export const requireScope = async (
  req: Request,
  ownerType: OwnerType,
  scope: string,
): Promise<AuthedKey | Response> => {
  const key = await authenticate(req);
  if (!key) return err(401, 'missing or invalid API key');
  if (key.ownerType !== ownerType) return err(403, 'wrong key type for this endpoint');
  if (!hasScope(key, scope)) return err(403, `missing scope: ${scope}`);
  return key;
};

export const isResponse = (x: unknown): x is Response => x instanceof Response;

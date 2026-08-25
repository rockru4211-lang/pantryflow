const INTERNAL_PASSWORD_BYTES = 32;
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function createInternalAuthPassword(random = crypto) {
  const bytes = new Uint8Array(INTERNAL_PASSWORD_BYTES);
  random.getRandomValues(bytes);
  const password = base64Url(bytes);
  if (!/^[A-Za-z0-9_-]+$/u.test(password) || new TextEncoder().encode(password).length >= BCRYPT_MAX_PASSWORD_BYTES) {
    throw new Error('INTERNAL_PASSWORD_GENERATION_FAILED');
  }
  return password;
}

export async function provisionStaffIdentity(operations, input) {
  const userId = operations.randomUUID();
  const internalEmail = `staff+${userId}@auth.pantryflow.invalid`;
  const internalPassword = createInternalAuthPassword(operations.crypto);
  const authResult = await operations.createAuthUser({
    id: userId,
    email: internalEmail,
    password: internalPassword,
    email_confirm: true,
  });
  if (authResult?.error) throw Object.assign(new Error('STAFF_AUTH_CREATE_FAILED'), { cause: authResult.error });

  let pinCreated = false;
  try {
    await operations.updateProfile(userId, input);
    await operations.insertOrganizationMember(userId, input);
    await operations.insertStaffIdentity(userId, input);
    await operations.insertStoreMembership(userId, input);
    await operations.setPin(userId, input.pin);
    pinCreated = true;
    await operations.insertAuditSuccess(userId, input);
  } catch (error) {
    if (pinCreated) {
      const pinRollback = await operations.deletePin(userId);
      if (pinRollback?.error) {
        throw Object.assign(new Error('STAFF_ROLLBACK_FAILED'), { cause: pinRollback.error, provisionError: error });
      }
    }
    const rollback = await operations.deleteAuthUser(userId);
    if (rollback?.error) {
      throw Object.assign(new Error('STAFF_ROLLBACK_FAILED'), { cause: rollback.error, provisionError: error });
    }
    throw error;
  }

  return { staffId: userId, storeId: input.storeId, role: input.role };
}

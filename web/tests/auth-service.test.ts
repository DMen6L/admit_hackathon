import { describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNT,
  DemoAuthService,
  InvalidCredentialsError,
} from '../src/auth/auth-service';
import { validateCredentials } from '../src/auth/credentials';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('demo authentication', () => {
  it('signs in with the documented demo account and restores the session', async () => {
    const persistent = new MemoryStorage();
    const session = new MemoryStorage();
    const auth = new DemoAuthService(persistent, session);

    const user = await auth.signIn({ ...DEMO_ACCOUNT, keepSignedIn: false });

    expect(user.email).toBe(DEMO_ACCOUNT.email);
    await expect(auth.restoreSession()).resolves.toEqual(user);
  });

  it('rejects invalid credentials without creating a session', async () => {
    const auth = new DemoAuthService(new MemoryStorage(), new MemoryStorage());

    await expect(auth.signIn({
      email: DEMO_ACCOUNT.email,
      password: 'incorrect-password',
      keepSignedIn: false,
    })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(auth.restoreSession()).resolves.toBeUndefined();
  });

  it('clears both persistent and tab sessions on sign out', async () => {
    const persistent = new MemoryStorage();
    const session = new MemoryStorage();
    const auth = new DemoAuthService(persistent, session);
    await auth.signIn({ ...DEMO_ACCOUNT, keepSignedIn: true });

    await auth.signOut();

    await expect(auth.restoreSession()).resolves.toBeUndefined();
  });
});

describe('credential validation', () => {
  it('reports malformed email and short password values', () => {
    expect(validateCredentials({
      email: 'not-an-email',
      password: 'short',
      keepSignedIn: false,
    })).toEqual({
      email: 'Enter a valid email address.',
      password: 'Password must contain at least 8 characters.',
    });
  });
});

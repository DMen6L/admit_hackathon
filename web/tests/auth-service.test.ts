import { describe, expect, it, vi } from 'vitest';
import {
  ApiAuthService,
  InvalidCredentialsError,
  type StorageAdapter,
} from '../src/auth/auth-service';
import { validateCredentials } from '../src/auth/credentials';

class MemoryStorage implements StorageAdapter {
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

const user = { id: 'd6f0e54b-8dd7-4c7a-9d38-8a3f88a5a4c2', login: 'arcane.wanderer' };
const authResponse = { accessToken: 'jwt-token', user };

function response(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function auth(fetchImpl: typeof fetch = vi.fn()): ApiAuthService {
  return new ApiAuthService(fetchImpl, new MemoryStorage(), new MemoryStorage(), 'http://api.test');
}

describe('API authentication', () => {
  it('registers with login/password and stores the returned token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(authResponse, true, 201));
    const service = auth(fetchImpl);

    await expect(service.register({ login: 'Arcane.Wanderer', password: 'Spellbound1', keepSignedIn: false }))
      .resolves.toEqual(user);
    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/api/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ login: 'Arcane.Wanderer', password: 'Spellbound1' }),
    }));
  });

  it('accepts snake_case auth responses from compatible backend deployments', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      access_token: 'jwt-token',
      user,
    }, true, 201));

    await expect(auth(fetchImpl).register({ login: 'mage', password: 'Spellbound1', keepSignedIn: false }))
      .resolves.toEqual(user);
  });

  it('preserves an editable display name separately from the sign-in login', async () => {
    const namedUser = { ...user, displayName: 'Moon Warden' };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ accessToken: 'jwt-token', user: namedUser }));

    await expect(auth(fetchImpl).signIn({ login: user.login, password: 'Spellbound1', keepSignedIn: false }))
      .resolves.toEqual(namedUser);
  });

  it('maps a 401 response to invalid credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ detail: 'The login or password is incorrect.' }, false, 401));

    await expect(auth(fetchImpl).signIn({ login: 'mage', password: 'wrongpass', keepSignedIn: false }))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('restores a stored session through the authenticated user endpoint', async () => {
    const persistent = new MemoryStorage();
    const session = new MemoryStorage();
    const loginFetch = vi.fn<typeof fetch>().mockResolvedValue(response(authResponse));
    const service = new ApiAuthService(loginFetch, persistent, session, 'http://api.test');
    await service.signIn({ login: 'mage', password: 'Spellbound1', keepSignedIn: true });

    const restoreFetch = vi.fn<typeof fetch>().mockResolvedValue(response(user));
    await expect(new ApiAuthService(restoreFetch, persistent, session, 'http://api.test').restoreSession())
      .resolves.toEqual(user);
    expect(restoreFetch).toHaveBeenCalledWith('http://api.test/api/auth/me', {
      headers: { Authorization: 'Bearer jwt-token' },
    });
  });

  it('clears stored sessions on sign out', async () => {
    const persistent = new MemoryStorage();
    const session = new MemoryStorage();
    const service = new ApiAuthService(
      vi.fn<typeof fetch>().mockResolvedValue(response(authResponse)),
      persistent,
      session,
      'http://api.test',
    );
    await service.signIn({ login: 'mage', password: 'Spellbound1', keepSignedIn: true });
    await service.signOut();

    const restoreFetch = vi.fn<typeof fetch>();
    await expect(new ApiAuthService(restoreFetch, persistent, session, 'http://api.test').restoreSession())
      .resolves.toBeUndefined();
    expect(restoreFetch).not.toHaveBeenCalled();
  });
});

describe('credential validation', () => {
  it('reports invalid login and short password values', () => {
    expect(validateCredentials({
      login: 'not a login',
      password: 'short',
      keepSignedIn: false,
    })).toEqual({
      login: 'Используйте от 3 до 64 строчных латинских букв, цифр, точек, дефисов или подчёркиваний.',
      password: 'Пароль должен содержать не меньше 8 символов.',
    });
  });
});

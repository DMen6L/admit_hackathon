export interface AuthCredentials {
  login: string;
  password: string;
  keepSignedIn: boolean;
}

export type SignInCredentials = AuthCredentials;
export type RegistrationCredentials = AuthCredentials;

export interface AuthUser {
  id: string;
  login: string;
}

export interface AuthService {
  restoreSession(): Promise<AuthUser | undefined>;
  signIn(credentials: SignInCredentials): Promise<AuthUser>;
  register(credentials: RegistrationCredentials): Promise<AuthUser>;
  signOut(): Promise<void>;
}

export class InvalidCredentialsError extends Error {
  constructor(message = 'The login or password is incorrect.') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class AuthRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AuthRequestError';
  }
}

interface StoredSession {
  version: 2;
  accessToken: string;
  user: AuthUser;
}

interface AuthResponse {
  accessToken?: unknown;
  access_token?: unknown;
  user?: unknown;
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_KEY = 'wizard-duel.auth-session.v2';
// Uvicorn is exposed on IPv4 by Docker and Vite binds to 127.0.0.1. Using
// the explicit IPv4 loopback avoids browsers resolving `localhost` to ::1.
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000';

function parseSession(value: string | null): StoredSession | undefined {
  if (!value) return undefined;

  try {
    const session = JSON.parse(value) as Partial<StoredSession>;
    const user = session.user;
    if (
      session.version !== 2
      || typeof session.accessToken !== 'string'
      || !session.accessToken
      || !user
      || typeof user.id !== 'string'
      || typeof user.login !== 'string'
    ) return undefined;
    return { version: 2, accessToken: session.accessToken, user };
  } catch {
    return undefined;
  }
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return configured?.replace(/\/$/, '') || DEFAULT_API_BASE_URL;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string') {
    return body.detail;
  }
  return fallback;
}

function parseAuthResponse(body: unknown): { accessToken: string; user: AuthUser } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;

  const response = body as AuthResponse;
  const accessToken = typeof response.accessToken === 'string'
    ? response.accessToken
    : typeof response.access_token === 'string'
      ? response.access_token
      : undefined;
  const candidate = response.user;
  if (
    !accessToken
    || typeof candidate !== 'object'
    || candidate === null
    || !('id' in candidate)
    || !('login' in candidate)
    || typeof candidate.id !== 'string'
    || typeof candidate.login !== 'string'
  ) return undefined;

  return { accessToken, user: { id: candidate.id, login: candidate.login } };
}

export class ApiAuthService implements AuthService {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly persistentStorage: StorageAdapter,
    private readonly sessionStorage: StorageAdapter,
    private readonly baseUrl = apiBaseUrl(),
  ) {}

  accessToken(): string | undefined {
    return this.readStoredSession()?.accessToken;
  }

  apiBaseUrl(): string {
    return this.baseUrl;
  }

  async restoreSession(): Promise<AuthUser | undefined> {
    const stored = this.readStoredSession();
    if (!stored) return undefined;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${stored.accessToken}` },
      });
      if (!response.ok) {
        this.clearStoredSessions();
        return undefined;
      }
      const user = await response.json() as AuthUser;
      if (typeof user.id !== 'string' || typeof user.login !== 'string') {
        this.clearStoredSessions();
        return undefined;
      }
      this.storeSession(stored.accessToken, user, this.hasPersistentSession());
      return user;
    } catch {
      this.clearStoredSessions();
      return undefined;
    }
  }

  signIn(credentials: SignInCredentials): Promise<AuthUser> {
    return this.authenticate('/api/auth/login', credentials);
  }

  register(credentials: RegistrationCredentials): Promise<AuthUser> {
    return this.authenticate('/api/auth/register', credentials);
  }

  async signOut(): Promise<void> {
    this.clearStoredSessions();
  }

  private async authenticate(path: string, credentials: AuthCredentials): Promise<AuthUser> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: credentials.login, password: credentials.password }),
      });
    } catch {
      throw new AuthRequestError(
        0,
        `Cannot reach the authentication server at ${this.baseUrl}. Check the backend and browser CORS settings.`,
      );
    }

    const body = await response.json().catch(() => undefined) as AuthResponse & { detail?: unknown } | undefined;
    const parsed = parseAuthResponse(body);
    if (!response.ok || !parsed) {
      const message = errorMessage(body, response.ok
        ? 'The authentication server returned an invalid response.'
        : `Authentication request failed (HTTP ${response.status}).`);
      if (response.status === 401) throw new InvalidCredentialsError(message);
      throw new AuthRequestError(response.status, message);
    }
    this.storeSession(parsed.accessToken, parsed.user, credentials.keepSignedIn);
    return parsed.user;
  }

  private readStoredSession(): StoredSession | undefined {
    return parseSession(this.sessionStorage.getItem(SESSION_KEY))
      ?? parseSession(this.persistentStorage.getItem(SESSION_KEY));
  }

  private hasPersistentSession(): boolean {
    return Boolean(parseSession(this.persistentStorage.getItem(SESSION_KEY)));
  }

  private storeSession(accessToken: string, user: AuthUser, persistent: boolean): void {
    const serialized = JSON.stringify({ version: 2, accessToken, user } satisfies StoredSession);
    const destination = persistent ? this.persistentStorage : this.sessionStorage;
    const alternative = persistent ? this.sessionStorage : this.persistentStorage;
    alternative.removeItem(SESSION_KEY);
    destination.setItem(SESSION_KEY, serialized);
  }

  private clearStoredSessions(): void {
    this.persistentStorage.removeItem(SESSION_KEY);
    this.sessionStorage.removeItem(SESSION_KEY);
  }
}

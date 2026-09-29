export interface SignInCredentials {
  email: string;
  password: string;
  keepSignedIn: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthService {
  restoreSession(): Promise<AuthUser | undefined>;
  signIn(credentials: SignInCredentials): Promise<AuthUser>;
  signOut(): Promise<void>;
}

export const DEMO_ACCOUNT = Object.freeze({
  email: 'mage@wizard.dev',
  password: 'Spellbound1',
});

export class InvalidCredentialsError extends Error {
  constructor() {
    super('The email or password is incorrect.');
    this.name = 'InvalidCredentialsError';
  }
}

interface StoredSession {
  version: 1;
  user: AuthUser;
}

interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_KEY = 'wizard-duel.auth-session.v1';

function parseSession(value: string | null): AuthUser | undefined {
  if (!value) return undefined;

  try {
    const session = JSON.parse(value) as Partial<StoredSession>;
    const user = session.user;
    if (
      session.version !== 1
      || !user
      || typeof user.id !== 'string'
      || typeof user.email !== 'string'
      || typeof user.displayName !== 'string'
    ) return undefined;
    return user;
  } catch {
    return undefined;
  }
}

/**
 * Local authentication for the runnable prototype. It stores only a display
 * session, never credentials. Replace this implementation with an HTTP-backed
 * AuthService when a server becomes part of the project.
 */
export class DemoAuthService implements AuthService {
  constructor(
    private readonly persistentStorage: StorageAdapter,
    private readonly sessionStorage: StorageAdapter,
  ) {}

  async restoreSession(): Promise<AuthUser | undefined> {
    return parseSession(this.sessionStorage.getItem(SESSION_KEY))
      ?? parseSession(this.persistentStorage.getItem(SESSION_KEY));
  }

  async signIn(credentials: SignInCredentials): Promise<AuthUser> {
    const email = credentials.email.trim().toLowerCase();
    if (email !== DEMO_ACCOUNT.email || credentials.password !== DEMO_ACCOUNT.password) {
      throw new InvalidCredentialsError();
    }

    const user: AuthUser = {
      id: 'demo-arcane-warden',
      email,
      displayName: 'Arcane Warden',
    };
    const serialized = JSON.stringify({ version: 1, user } satisfies StoredSession);
    const destination = credentials.keepSignedIn ? this.persistentStorage : this.sessionStorage;
    const alternative = credentials.keepSignedIn ? this.sessionStorage : this.persistentStorage;
    alternative.removeItem(SESSION_KEY);
    destination.setItem(SESSION_KEY, serialized);
    return user;
  }

  async signOut(): Promise<void> {
    this.persistentStorage.removeItem(SESSION_KEY);
    this.sessionStorage.removeItem(SESSION_KEY);
  }
}

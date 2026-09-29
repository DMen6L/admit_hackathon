import type { SignInCredentials } from './auth-service';

const LOGIN_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,63}$/;

export interface CredentialErrors {
  login?: string;
  password?: string;
}

export function validateCredentials(credentials: SignInCredentials): CredentialErrors {
  const errors: CredentialErrors = {};
  const login = credentials.login.trim().toLowerCase();

  if (!login) errors.login = 'Enter your login.';
  else if (!LOGIN_PATTERN.test(login)) errors.login = 'Use 3-64 lowercase letters, numbers, dots, dashes, or underscores.';

  if (!credentials.password) errors.password = 'Enter your password.';
  else if (credentials.password.length < 8) errors.password = 'Password must contain at least 8 characters.';

  return errors;
}

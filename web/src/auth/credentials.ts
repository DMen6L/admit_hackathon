import type { SignInCredentials } from './auth-service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CredentialErrors {
  email?: string;
  password?: string;
}

export function validateCredentials(credentials: SignInCredentials): CredentialErrors {
  const errors: CredentialErrors = {};
  const email = credentials.email.trim();

  if (!email) errors.email = 'Enter your email address.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';

  if (!credentials.password) errors.password = 'Enter your password.';
  else if (credentials.password.length < 8) errors.password = 'Password must contain at least 8 characters.';

  return errors;
}

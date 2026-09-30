import type { SignInCredentials } from './auth-service';

const LOGIN_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,63}$/;

export interface CredentialErrors {
  login?: string;
  password?: string;
}

export function validateCredentials(credentials: SignInCredentials): CredentialErrors {
  const errors: CredentialErrors = {};
  const login = credentials.login.trim().toLowerCase();

  if (!login) errors.login = 'Введите логин.';
  else if (!LOGIN_PATTERN.test(login)) errors.login = 'Используйте от 3 до 64 строчных латинских букв, цифр, точек, дефисов или подчёркиваний.';

  if (!credentials.password) errors.password = 'Введите пароль.';
  else if (credentials.password.length < 8) errors.password = 'Пароль должен содержать не меньше 8 символов.';

  return errors;
}

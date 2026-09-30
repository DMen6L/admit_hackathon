const SERVER_ERRORS: Record<string, string> = {
  'The login or password is incorrect.': 'Неверный логин или пароль.',
  'Login must contain 3-64 lowercase letters, numbers, dots, dashes, or underscores.': 'Логин должен содержать от 3 до 64 строчных латинских букв, цифр, точек, дефисов или подчёркиваний.',
  'That login is already in use.': 'Этот логин уже занят.',
  'Authentication required.': 'Нужно войти в аккаунт.',
  'Invalid authentication token.': 'Сеанс истёк. Войдите снова.',
  'Room not found.': 'Комната не найдена.',
  'Room is full or already started.': 'Комната заполнена или дуэль уже началась.',
  'Room seat not found.': 'Место игрока в комнате не найдено.',
  'Room capacity reached. Try again shortly.': 'Все комнаты заняты. Попробуйте немного позже.',
  'Display name must be 2–32 visible characters.': 'Имя должно содержать от 2 до 32 видимых символов.',
};

export function serverError(detail: unknown, fallback: string): string {
  if (typeof detail !== 'string') return fallback;
  return SERVER_ERRORS[detail] ?? (/[А-Яа-яЁё]/.test(detail) ? detail : fallback);
}

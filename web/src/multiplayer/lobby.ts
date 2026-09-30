import type { ApiAuthService } from '../auth/auth-service';
import { normalizeRoomCode } from './room-code';
import { serverError } from '../ui/server-error';

export function mountRoomLobby(auth: ApiAuthService): void {
  const root = document.querySelector<HTMLElement>('#room-lobby')!;
  const status = root.querySelector<HTMLElement>('[data-room-status]')!;
  const create = root.querySelector<HTMLButtonElement>('[data-room-create]')!;
  const join = root.querySelector<HTMLFormElement>('[data-room-join]')!;
  const joinButton = join.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const input = root.querySelector<HTMLInputElement>('[data-room-code]')!;
  const enter = (roomCode: string) => {
    const url = new URL('battle.html', window.location.href);
    url.searchParams.set('room', roomCode);
    window.location.assign(url.toString());
  };
  create.addEventListener('click', async () => {
    const token = auth.accessToken();
    if (!token) { status.textContent = 'Войдите снова, чтобы создать комнату.'; return; }
    create.disabled = true;
    status.textContent = 'Создаём комнату…';
    try {
      const response = await fetch(`${auth.apiBaseUrl()}/api/rooms`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as { code?: string; detail?: string };
      const code = body.code && normalizeRoomCode(body.code);
      if (!response.ok || !code) throw new Error(serverError(body.detail, 'Не удалось создать комнату.'));
      enter(code);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось создать комнату.';
      create.disabled = false;
    }
  });
  join.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = normalizeRoomCode(input.value);
    if (!code) { status.textContent = 'Введите шестизначный код комнаты.'; input.focus(); return; }
    const token = auth.accessToken();
    if (!token) { status.textContent = 'Войдите снова, чтобы присоединиться к комнате.'; return; }
    joinButton.disabled = true;
    status.textContent = `Проверяем комнату ${code}…`;
    try {
      const response = await fetch(`${auth.apiBaseUrl()}/api/rooms/${code}/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(serverError(body.detail, 'Не удалось войти в комнату.'));
      enter(code);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось войти в комнату.';
      joinButton.disabled = false;
    }
  });
}

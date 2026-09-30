import type { ApiAuthService } from '../auth/auth-service';
import { normalizeRoomCode } from './room-code';

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
    if (!token) { status.textContent = 'Sign in again to create a room.'; return; }
    create.disabled = true;
    status.textContent = 'Creating a room…';
    try {
      const response = await fetch(`${auth.apiBaseUrl()}/api/rooms`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as { code?: string; detail?: string };
      const code = body.code && normalizeRoomCode(body.code);
      if (!response.ok || !code) throw new Error(body.detail ?? 'Could not create room.');
      enter(code);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not create room.';
      create.disabled = false;
    }
  });
  join.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = normalizeRoomCode(input.value);
    if (!code) { status.textContent = 'Enter the six-character room code.'; input.focus(); return; }
    const token = auth.accessToken();
    if (!token) { status.textContent = 'Sign in again to join a room.'; return; }
    joinButton.disabled = true;
    status.textContent = `Checking room ${code}…`;
    try {
      const response = await fetch(`${auth.apiBaseUrl()}/api/rooms/${code}/join`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(body.detail ?? 'Could not join this room.');
      enter(code);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not join this room.';
      joinButton.disabled = false;
    }
  });
}

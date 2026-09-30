import '../style.css';
import './lobby.css';
import { ApiAuthService } from '../auth/auth-service';
import { mountRoomLobby } from './lobby';

const auth = new ApiAuthService(globalThis.fetch.bind(globalThis), window.localStorage, window.sessionStorage);
const screen = document.querySelector<HTMLElement>('#lobby-screen')!;
const sessionStatus = document.querySelector<HTMLElement>('#lobby-session-status')!;

void auth.restoreSession().then((user) => {
  if (!user) { window.location.replace(import.meta.env.BASE_URL); return; }
  document.querySelector<HTMLElement>('#current-user')!.textContent = user.displayName || user.login;
  screen.hidden = false;
  sessionStatus.hidden = true;
  mountRoomLobby(auth);
}).catch(() => {
  sessionStatus.textContent = 'Lobby unavailable. Return to sign in and try again.';
});

document.querySelector<HTMLButtonElement>('#sign-out')!.addEventListener('click', () => {
  void auth.signOut().then(() => window.location.replace(import.meta.env.BASE_URL));
});

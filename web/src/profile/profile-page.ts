import '../style.css';
import './profile.css';
import { ApiAuthService } from '../auth/auth-service';

interface Profile {
  id: string;
  login: string;
  displayName: string;
  createdAt: string;
  online: { played: number; won: number; lost: number; drawn: number };
}

const auth = new ApiAuthService(globalThis.fetch.bind(globalThis), window.localStorage, window.sessionStorage);
const screen = document.querySelector<HTMLElement>('#profile-screen')!;
const loading = document.querySelector<HTMLElement>('#profile-loading')!;
const form = document.querySelector<HTMLFormElement>('#name-form')!;
const input = document.querySelector<HTMLInputElement>('#display-name')!;
const saveButton = document.querySelector<HTMLButtonElement>('#save-name')!;
const status = document.querySelector<HTMLElement>('#name-status')!;
let profile: Profile | undefined;

function render(data: Profile): void {
  profile = data;
  document.querySelector<HTMLElement>('[data-display-name]')!.textContent = data.displayName;
  document.querySelector<HTMLElement>('[data-avatar]')!.textContent = data.displayName.trim().charAt(0).toUpperCase() || '✧';
  document.querySelectorAll<HTMLElement>('[data-login]').forEach((element) => { element.textContent = data.login; });
  const date = new Date(data.createdAt);
  const joined = document.querySelector<HTMLTimeElement>('[data-joined]')!;
  joined.textContent = Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
  joined.dateTime = Number.isNaN(date.getTime()) ? '' : date.toISOString();
  for (const key of ['played', 'won', 'lost', 'drawn'] as const) {
    document.querySelector<HTMLElement>(`[data-stat="${key}"]`)!.textContent = String(data.online[key]);
  }
  document.querySelector<HTMLElement>('[data-stat="win-rate"]')!.textContent =
    `${data.online.played ? Math.round(data.online.won / data.online.played * 100) : 0}%`;
  input.value = data.displayName;
}

void auth.restoreSession().then(async (user) => {
  if (!user) { window.location.replace(import.meta.env.BASE_URL); return; }
  const token = auth.accessToken();
  if (!token) throw new Error('Sign in again to view your profile.');
  const response = await fetch(`${auth.apiBaseUrl()}/api/profile`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Profile unavailable (HTTP ${response.status}).`);
  render(await response.json() as Profile);
  screen.hidden = false;
  loading.hidden = true;
}).catch((error: unknown) => {
  loading.textContent = error instanceof Error ? error.message : 'Profile unavailable. Return to sign in and try again.';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!profile) return;
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 32) {
    status.textContent = 'Use a display name between 2 and 32 characters.';
    input.focus();
    return;
  }
  if (name === profile.displayName) { status.textContent = 'Your name is already up to date.'; return; }
  const token = auth.accessToken();
  if (!token) { status.textContent = 'Your session expired. Sign in again.'; return; }
  saveButton.disabled = true;
  status.textContent = 'Saving your name…';
  try {
    const response = await fetch(`${auth.apiBaseUrl()}/api/profile`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
    });
    const body = await response.json() as Profile & { detail?: string };
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not save your name.');
    render(body);
    await auth.restoreSession();
    status.textContent = 'Name saved. New duels will show your updated name.';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not save your name.';
  } finally {
    saveButton.disabled = false;
  }
});

document.querySelector<HTMLButtonElement>('#profile-sign-out')!.addEventListener('click', () => {
  void auth.signOut().then(() => window.location.replace(import.meta.env.BASE_URL));
});

const ROOM_CODE = /^[A-Z0-9]{6}$/;

export function normalizeRoomCode(value: string): string | undefined {
  const code = value.trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : undefined;
}

export function roomCodeFromSearch(search: string): string | undefined {
  const value = new URLSearchParams(search).get('room');
  return value ? normalizeRoomCode(value) : undefined;
}

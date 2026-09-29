export type PlayerIdentity = {
  name: string;
  anonymous: boolean;
  email: string;
};

const KEY = 'guitar_player';
const GUEST_KEY = 'guitar_guest_name';

export function randomPlayerName(): string {
  return `UNKNOWN${Math.floor(100000 + Math.random() * 900000)}`;
}

export function readPlayer(): PlayerIdentity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PlayerIdentity>;
    const name = String(data.name || '').trim();
    if (!name) return null;
    return {
      name: name.slice(0, 16),
      anonymous: data.anonymous !== false,
      email: String(data.email || '')
    };
  } catch {
    return null;
  }
}

export function writePlayer(player: PlayerIdentity): void {
  const saved: PlayerIdentity = {
    name: player.name.trim().slice(0, 16),
    anonymous: player.anonymous,
    email: player.email.trim()
  };
  localStorage.setItem(KEY, JSON.stringify(saved));
  localStorage.setItem(GUEST_KEY, saved.name);
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, '').slice(0, 16).toUpperCase();
}

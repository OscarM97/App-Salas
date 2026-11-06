/** Utilidades de color para los tonos de cada persona/sala (hex dinámicos). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export const PROFILE_COLORS = ['#2563eb', '#db2777', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5', '#c026d3', '#0d9488', '#65a30d', '#ea580c', '#475569'];
export const ROOM_COLORS = ['#4f46e5', '#ea580c', '#0d9488', '#db2777', '#2563eb', '#ca8a04', '#7c3aed', '#16a34a'];
export const PROFILE_EMOJIS = ['👨', '👩', '🧑', '👦', '👧', '🧔', '👱‍♀️', '👵', '👴', '🧒', '😎', '🤓', '🦊', '🐱', '🐶', '🐼', '🦄', '⚽', '🎸', '🎮', '🌟', '🔥', '🌈', '🍕'];

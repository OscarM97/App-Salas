import { BookOpen, Coffee, EighthNote, Gamepad2, House, Popcorn, Sofa, Sun, Trees, Tv, type LucideIcon } from 'lucide-react';
import { withAlpha } from '@/lib/colors';
import { cn } from './ui/cn';

export const ROOM_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  tv: { icon: Tv, label: 'TV' },
  sofa: { icon: Sofa, label: 'Sillón' },
  trees: { icon: Trees, label: 'Terraza' },
  gamepad: { icon: Gamepad2, label: 'Juegos' },
  music: { icon: EighthNote, label: 'Música' },
  book: { icon: BookOpen, label: 'Estudio' },
  coffee: { icon: Coffee, label: 'Café' },
  sun: { icon: Sun, label: 'Jardín' },
  popcorn: { icon: Popcorn, label: 'Cine' },
  home: { icon: House, label: 'Casa' },
};

export function RoomIcon({ icon, color, size = 'md', className }: { icon: string; color: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = ROOM_ICONS[icon]?.icon ?? Sofa;
  const box = size === 'sm' ? 'size-7 rounded-lg' : size === 'lg' ? 'size-12 rounded-2xl' : 'size-10 rounded-xl';
  const glyph = size === 'sm' ? 'size-4' : size === 'lg' ? 'size-6' : 'size-5';
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box, className)} style={{ backgroundColor: withAlpha(color, 0.14), color }}>
      <Icon className={glyph} aria-hidden />
    </span>
  );
}

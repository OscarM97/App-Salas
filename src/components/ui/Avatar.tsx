import { withAlpha } from '@/lib/colors';
import { cn } from './cn';

interface AvatarProps {
  emoji: string;
  color: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  ring?: boolean;
}

const sizes = {
  xs: 'size-6 text-sm',
  sm: 'size-8 text-base',
  md: 'size-10 text-xl',
  lg: 'size-14 text-3xl',
  xl: 'size-20 text-5xl',
};

export function Avatar({ emoji, color, name, size = 'md', className, ring }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full leading-none', sizes[size], className)}
      style={{
        backgroundColor: withAlpha(color, 0.18),
        boxShadow: ring ? `0 0 0 2px var(--app-surface), 0 0 0 4px ${color}` : `inset 0 0 0 1.5px ${withAlpha(color, 0.45)}`,
      }}
    >
      <span aria-hidden>{emoji}</span>
    </span>
  );
}

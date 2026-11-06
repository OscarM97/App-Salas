import { CalendarPlus, CircleX, House, LockOpen, SquarePen } from 'lucide-react';
import type { ActivityEntry, Profile, Room } from '@/types';
import { describeActivity } from '@/lib/activity';
import { timeAgo } from '@/lib/time';
import { Avatar } from './ui/Avatar';
import { cn } from './ui/cn';

const toneIcon = {
  created: { Icon: CalendarPlus, cls: 'text-free' },
  updated: { Icon: SquarePen, cls: 'text-brand' },
  cancelled: { Icon: CircleX, cls: 'text-danger' },
  released: { Icon: LockOpen, cls: 'text-free' },
  room: { Icon: House, cls: 'text-muted' },
} as const;

interface ActivityItemProps {
  a: ActivityEntry;
  profiles: Map<string, Profile>;
  rooms: Map<string, Room>;
  now: Date;
  unread?: boolean;
  onClick?: () => void;
}

export function ActivityItem({ a, profiles, rooms, now, unread, onClick }: ActivityItemProps) {
  const view = describeActivity(a, profiles, rooms, now);
  const { Icon, cls } = toneIcon[view.tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('flex w-full gap-3 rounded-2xl p-3 text-left transition', unread ? 'bg-brand/8' : 'bg-transparent', onClick && 'active:bg-surface-2')}
    >
      <div className="relative">
        <Avatar emoji={view.actor?.emoji ?? '🙂'} color={view.actor?.color ?? '#64748b'} name={view.actor?.name} size="md" />
        <span className={cn('absolute -bottom-1 -right-1 rounded-full bg-surface p-0.5', cls)}>
          <Icon className="size-3.5" aria-hidden />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug">{view.text}</p>
        <p className="mt-0.5 text-xs text-muted">{timeAgo(a.created_at, now)}</p>
      </div>
      {unread ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Nuevo" /> : null}
    </Comp>
  );
}

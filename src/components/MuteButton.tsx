import { Bell, BellOff } from 'lucide-react';
import { setMuted, useMuted } from '../social/mute';
import { toast } from './ui';

export function MuteButton({ id }: { id: string }) {
  const m = useMuted().includes(id);
  return (
    <button className="btn ghost sm" title={m ? 'Show their chat messages again' : 'Fold away their chat messages and stop notifications. They aren’t told.'}
      onClick={() => { setMuted(id, !m); toast(m ? 'Unmuted' : 'Muted: their messages are folded away'); }}>
      {m ? <Bell size={13} /> : <BellOff size={13} />} {m ? 'Unmute' : 'Mute'}
    </button>
  );
}

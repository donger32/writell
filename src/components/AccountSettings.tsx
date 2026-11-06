/* Settings → Account & sync */
import { useState } from 'react';
import { Cloud, CloudOff, Copy, KeyRound, LogOut, RefreshCw, ShieldCheck, Pause, Play } from 'lucide-react';
import { applyRecoveryKey, changePassword, sendPasswordReset, setPaused, signIn, signOut, signUp, syncNow, useSyncStatus, type Phase } from '../sync/engine';
import { confirmDialog, toast } from './ui';
import { timeAgo } from '../util';

export const PHASE_LABEL: Record<Phase, string> = {
  'signed-out': 'Not signed in', 'needs-recovery': 'Needs your recovery key', paused: 'Sync paused on this device',
  syncing: 'Syncing…', synced: 'Synced', offline: 'Offline: will sync when you’re back online', error: 'Sync problem', 'setup-missing': 'Supabase isn’t set up yet',
};

export function AccountSettings() {
  const st = useSyncStatus();
  const [recovery, setRecovery] = useState<string | null>(null);
  if (recovery) return <RecoveryCard code={recovery} onDone={() => setRecovery(null)} />;
  if (st.phase === 'signed-out') return <SignInForm onRecovery={setRecovery} />;
  if (st.phase === 'needs-recovery') return <RecoveryForm />;
  return <SignedIn />;
}

function Explainer() {
  return (
    <div className="acct-explain">
      <ShieldCheck size={18} className="accent" />
      <div>
        <strong>Your writing, on all your devices, private.</strong>
        <p className="muted small">Sign in on your PC, phone or laptop and your projects follow you. Everything is encrypted on your device before it's uploaded, so not even the server can read it. Writell keeps working offline and catches up when you're back online.</p>
      </div>
    </div>
  );
}

function SignInForm({ onRecovery }: { onRecovery: (code: string) => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const submit = async () => {
    setMsg(null);
    if (!email.trim() || !pw) return setMsg({ text: 'Enter your email and password.', bad: true });
    if (mode === 'up' && pw.length < 8) return setMsg({ text: 'Use at least 8 characters for your password.', bad: true });
    if (mode === 'up' && pw !== pw2) return setMsg({ text: 'The two passwords don’t match.', bad: true });
    setBusy(true);
    try {
      if (mode === 'up') {
        const r = await signUp(email.trim(), pw);
        if (r === 'confirm') { setMsg({ text: `Almost done: we sent a link to ${email.trim()}. Tap it to confirm your email, then come back here and sign in.` }); setMode('in'); setPw2(''); }
        else onRecovery(r.recovery);
      } else {
        const r = await signIn(email.trim(), pw);
        if (r !== 'needs-recovery' && r.recovery) onRecovery(r.recovery);
        else if (r !== 'needs-recovery') toast('Signed in: syncing your projects');
      }
    } catch (e) {
      const m = (e as Error).message || String(e);
      setMsg({ bad: true, text: /invalid login/i.test(m) ? 'Wrong email or password.' : /not confirmed/i.test(m) ? 'Please confirm your email first. Check your inbox for the link.' : /already registered/i.test(m) ? 'There’s already an account with this email. Sign in instead.' : /fetch|network/i.test(m) ? 'Can’t reach the server. Check your internet connection.' : m });
    } finally { setBusy(false); }
  };
  return (
    <div className="col gap">
      <h3>Account &amp; sync</h3>
      <Explainer />
      <div className="seg" role="tablist">
        <button className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setMsg(null); }}>Sign in</button>
        <button className={mode === 'up' ? 'on' : ''} onClick={() => { setMode('up'); setMsg(null); }}>Create account</button>
      </div>
      <form className="col gap-s acct-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="sfield"><span>Email</span><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="sfield"><span>Password</span><input className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {mode === 'up' && <label className="sfield"><span>Password again</span><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
        {msg && <p className={'small ' + (msg.bad ? 'danger-text' : 'acct-ok')}>{msg.text}</p>}
        <div className="row gap-s wrap">
          <button className="btn primary" disabled={busy}>{busy ? 'One moment…' : mode === 'up' ? 'Create account' : 'Sign in'}</button>
          {mode === 'in' && <button type="button" className="btn ghost sm" onClick={async () => {
            if (!email.trim()) return setMsg({ text: 'Type your email first, then tap “Forgot password”.', bad: true });
            try { await sendPasswordReset(email.trim()); setMsg({ text: 'We sent a reset link. After choosing a new password, sign in here. You’ll then need your recovery key once to unlock your writing.' }); }
            catch (e) { setMsg({ text: (e as Error).message, bad: true }); }
          }}>Forgot password?</button>}
        </div>
        {mode === 'up' && <p className="muted small">Your password also locks your writing. After you create the account, you'll get a <strong>recovery key</strong>: the only way back in if you ever forget your password.</p>}
      </form>
      <p className="muted small">Signing in uploads the projects on this device to your account, and downloads the ones from your other devices. Nothing is deleted.</p>
    </div>
  );
}

function RecoveryCard({ code, onDone }: { code: string; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="col gap">
      <h3>Save your recovery key</h3>
      <p>If you ever forget your password, this key is the <strong>only</strong> way to unlock your writing in the cloud. Nobody, not even the server, can recover it for you.</p>
      <div className="recovery-code" aria-label="Recovery key">{code}</div>
      <div className="row gap-s wrap">
        <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(code); toast('Copied'); } catch { toast('Select the key and copy it'); } }}><Copy size={14} /> Copy</button>
      </div>
      <p className="muted small">Keep it somewhere safe that isn't this device: a password manager, a note on your other phone, or written on paper.</p>
      <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I've saved my recovery key somewhere safe</label>
      <div><button className="btn primary" disabled={!ok} onClick={onDone}>Done</button></div>
    </div>
  );
}

function RecoveryForm() {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="col gap">
      <h3>Unlock with your recovery key</h3>
      <p className="muted">Your password was changed, so your writing needs your recovery key once to unlock. After that, your new password works on its own.</p>
      <input className="input mono" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      {msg && <p className="small danger-text">{msg}</p>}
      <div className="row gap-s">
        <button className="btn primary" disabled={busy || !code.trim()} onClick={async () => { setBusy(true); setMsg(''); try { await applyRecoveryKey(code); toast('Unlocked: syncing your projects'); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>Unlock</button>
        <button className="btn ghost" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}

function SignedIn() {
  const st = useSyncStatus();
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState(''); const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const bad = st.phase === 'error' || st.phase === 'setup-missing';
  return (
    <div className="col gap">
      <h3>Account &amp; sync</h3>
      <div className="acct-card">
        <div className="row gap-s"><Cloud size={16} className="accent" /><strong className="grow ellipsis">{st.email}</strong></div>
        <div className={'acct-status ' + st.phase}>
          <span className="dot" /> {PHASE_LABEL[st.phase]}
          {st.phase === 'synced' && st.lastSync ? <span className="muted"> · {timeAgo(st.lastSync)}</span> : null}
          {st.pending > 0 && st.phase !== 'synced' ? <span className="muted"> · {st.pending} change{st.pending === 1 ? '' : 's'} waiting</span> : null}
        </div>
        {st.phase === 'setup-missing' && <p className="small danger-text">The storage tables aren't in your Supabase project yet. Run the setup script in Supabase → SQL Editor, then tap “Sync now”.</p>}
        {st.phase === 'error' && st.message && <p className="small danger-text">{st.message}</p>}
        <div className="row gap-s wrap">
          <button className="btn sm" disabled={st.phase === 'syncing' || st.phase === 'paused'} onClick={() => syncNow({ scan: true })}><RefreshCw size={13} className={st.phase === 'syncing' ? 'spin' : ''} /> Sync now</button>
          {st.phase === 'paused'
            ? <button className="btn sm" onClick={() => setPaused(false)}><Play size={13} /> Resume syncing</button>
            : <button className="btn sm" onClick={() => setPaused(true)} title="Stop syncing on this device for now"><Pause size={13} /> Pause on this device</button>}
        </div>
        {bad && null}
      </div>
      <p className="muted small">Projects, chapters, scenes, characters, worldbuilding, notes, maps, trees, timelines, pictures and your word-count history sync. Each scene's revision history, in-app backups and the trash stay on each device.</p>

      <div className="col gap-s">
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPwOpen((v) => !v)}><KeyRound size={13} /> Change password</button>
        {pwOpen && (
          <form className="col gap-s acct-form" onSubmit={async (e) => {
            e.preventDefault(); setMsg(null);
            if (newPw.length < 8) return setMsg({ text: 'Use at least 8 characters.', bad: true });
            try { await changePassword(oldPw, newPw); setMsg({ text: 'Password changed. Use the new one on your other devices next time you sign in.' }); setOldPw(''); setNewPw(''); }
            catch (err) { setMsg({ text: (err as Error).message, bad: true }); }
          }}>
            <label className="sfield"><span>Current password</span><input className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} /></label>
            <label className="sfield"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></label>
            {msg && <p className={'small ' + (msg.bad ? 'danger-text' : 'acct-ok')}>{msg.text}</p>}
            <div><button className="btn primary sm">Change password</button></div>
          </form>
        )}
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={async () => {
          if (await confirmDialog('Sign out on this device?', 'Your projects stay on this device; they just stop syncing. Sign in again any time to pick up where you left off.', { ok: 'Sign out' })) { await signOut(); toast('Signed out'); }
        }}><LogOut size={13} /> Sign out</button>
      </div>
    </div>
  );
}

/** Small line at the bottom of the sidebar */
export function SyncBadge({ onOpen, iconOnly }: { onOpen: () => void; iconOnly?: boolean }) {
  const st = useSyncStatus();
  const Icon = st.phase === 'signed-out' || st.phase === 'offline' || st.phase === 'paused' ? CloudOff : st.phase === 'syncing' ? RefreshCw : Cloud;
  const label = st.phase === 'signed-out' ? 'Sign in to sync' : PHASE_LABEL[st.phase];
  return (
    <button className={'nav-item sync-badge ' + st.phase} onClick={onOpen} title={label} aria-label={label}>
      <Icon size={16} className={st.phase === 'syncing' ? 'spin' : ''} />
      {!iconOnly && <span className="grow ellipsis">{st.phase === 'synced' ? 'Synced' : label}</span>}
      {st.phase !== 'signed-out' && <span className="sync-dot" />}
    </button>
  );
}

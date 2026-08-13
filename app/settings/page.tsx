import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBuilding, faTrash, faArrowLeft, faKey, faUserPlus, faEnvelopeOpenText,
} from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import { SCOPES, describeScope } from '@/lib/apikey';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';
import { createOrg, revokeKey, inviteMember, revokeInvite, acceptInvite } from './actions';
import IssueKeyForm from './IssueKeyForm';

type KeyRow = {
  id: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
type Member = { id: string; email: string | null; role: string };
type Invite = { id: string; email: string; status: string; org_id: string; created_at: string };

export default async function SettingsPage() {
  const session = await getProfile();
  if (!session) redirect('/login');
  const { userId, profile } = session;
  const isRecruiter = profile.role === 'recruiter';

  // Which permissions this user may put on a key. The server owns this list;
  // IssueKeyForm only renders it, and issueKey re-validates whatever comes back
  // against the owner type it derives from the profile itself.
  const keyOwnerType = isRecruiter ? 'org' : 'candidate';
  const scopeOptions = (SCOPES[keyOwnerType] as readonly string[]).map((value) => ({
    value,
    ...describeScope(keyOwnerType, value),
  }));

  // Session client throughout. RLS scopes every list here: `org: read own`,
  // `api_keys: candidate own`/`org own`, and the two invite policies — one for
  // the org's recruiters, one for the invitee's own email.
  //
  // The members query is the exception and carries an explicit org_id filter.
  // That is not a redundant auth check: `users: recruiter read own org
  // candidates` (migration 004) is permissive and ORs with `users: read self`,
  // so an unfiltered select also returns every candidate who has submitted to
  // this org. Those rows are legitimately readable — they are just not team
  // members. Belonging to the organization is what "team member" means, and
  // org_id is the column that says so.
  const supabase = await createClient();
  const [{ data: org }, { data: keys }, { data: members }, { data: invites }] = await Promise.all([
    supabase.from('organizations').select('id, name').maybeSingle(),
    supabase
      .from('api_keys')
      .select('id, key_prefix, scopes, created_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false }),
    isRecruiter && profile.org_id
      ? supabase
          .from('users')
          .select('id, email, role')
          .eq('org_id', profile.org_id)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as Member[] }),
    supabase.from('org_invites').select('id, email, status, org_id, created_at'),
  ]);

  const inviteList = (invites as Invite[] | null) ?? [];
  // Invites this org sent (visible via the recruiter policy) vs invites
  // addressed to me (visible via the invitee policy).
  const sentInvites = inviteList.filter((i) => i.status === 'pending' && i.org_id === profile.org_id);
  const myInvites = inviteList.filter(
    (i) => i.status === 'pending' && i.email.toLowerCase() === (profile.email ?? '').toLowerCase(),
  );

  return (
    <main className="min-h-dvh">
      <nav className="max-w-2xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
        <ThemeToggle />
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <div>
          <Link href="/dashboard" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5">
            <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-ink mt-2">Settings</h1>
          <p className="text-sm text-muted mt-1">
            {profile.email} · <span className="badge badge-muted capitalize">{profile.role}</span>
          </p>
        </div>

        {/* A4 — invitations addressed to me */}
        {myInvites.length > 0 && (
          <section className="card p-6 border-accent-line bg-accent-soft/40">
            <h2 className="font-semibold text-ink mb-3 flex items-center gap-2">
              <FontAwesomeIcon icon={faEnvelopeOpenText} className="w-4 h-4 text-accent" />
              Team invitations
            </h2>
            <ul className="space-y-2">
              {myInvites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-surface px-3 py-2">
                  <span className="text-sm text-ink-soft">
                    You’ve been invited to join a team as a recruiter.
                  </span>
                  <form action={acceptInvite}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="btn btn-primary btn-sm">Accept</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Organization / recruiter onboarding */}
        <section className="card p-6">
          <h2 className="font-semibold text-ink mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faBuilding} className="w-4 h-4 text-accent" />
            Organization
          </h2>
          {isRecruiter ? (
            <p className="text-sm text-muted">
              You’re a recruiter at <span className="font-semibold text-ink">{org?.name ?? 'your org'}</span>.
              Manage jobs and evaluations from the{' '}
              <Link href="/recruiter" className="text-accent hover:underline font-medium">recruiter dashboard</Link>.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted mb-3">
                Create an organization to post jobs and evaluate candidates. This makes you a recruiter.
              </p>
              <form action={createOrg} className="flex gap-2">
                <input type="text" name="name" required placeholder="Acme Inc." className="field flex-1" />
                <button type="submit" className="btn btn-primary">Create</button>
              </form>
            </>
          )}
        </section>

        {/* A4 — team members */}
        {isRecruiter && profile.org_id && (
          <section className="card p-6">
            <h2 className="font-semibold text-ink mb-1 flex items-center gap-2">
              <FontAwesomeIcon icon={faUserPlus} className="w-4 h-4 text-accent" /> Team
            </h2>
            <p className="text-sm text-muted mb-4">
              Invite a teammate by email. They accept from their own Settings page after signing in.
            </p>

            <form action={inviteMember} className="flex gap-2">
              <input type="email" name="email" required placeholder="teammate@acme.com" className="field flex-1" />
              <button type="submit" className="btn btn-dark">Invite</button>
            </form>

            <ul className="mt-5 space-y-2">
              {(members as Member[] | null)?.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded-lg border border-hairline px-3 py-2">
                  <span className="text-sm text-ink-soft truncate">{m.email ?? m.id.slice(0, 8)}</span>
                  <span className="badge badge-muted capitalize shrink-0">
                    {m.id === userId ? 'you' : m.role}
                  </span>
                </li>
              ))}
              {sentInvites.map((i) => (
                <li key={i.id} className="flex items-center justify-between rounded-lg border border-dashed border-hairline px-3 py-2">
                  <span className="text-sm text-muted truncate">{i.email}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="badge badge-warn">pending</span>
                    <form action={revokeInvite}>
                      <input type="hidden" name="id" value={i.id} />
                      <button type="submit" className="text-subtle hover:text-red-600 dark:hover:text-red-400 cursor-pointer" title="Revoke invite">
                        <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* API keys */}
        <section className="card p-6">
          <h2 className="font-semibold text-ink mb-1 flex items-center gap-2">
            <FontAwesomeIcon icon={faKey} className="w-4 h-4 text-accent" /> API keys
          </h2>
          <p className="text-sm text-muted mb-4">
            {isRecruiter
              ? 'Org keys let your agents pull submissions and trigger evaluations at scale.'
              : 'Candidate keys let you list tasks and submit programmatically.'}
          </p>

          {isRecruiter && !profile.org_id ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">Create an organization first.</p>
          ) : (
            <IssueKeyForm scopeOptions={scopeOptions} />
          )}

          <ul className="mt-5 space-y-2">
            {(keys as KeyRow[] | null)?.map((k) => (
              <li key={k.id} className="rounded-lg border border-hairline px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <code className="text-xs font-mono text-ink-soft">{k.key_prefix}…</code>
                    {k.revoked_at && <span className="badge badge-danger">revoked</span>}
                  </div>
                  {!k.revoked_at && (
                    <form action={revokeKey}>
                      <input type="hidden" name="id" value={k.id} />
                      <button type="submit" className="text-subtle hover:text-red-600 dark:hover:text-red-400 cursor-pointer" title="Revoke">
                        <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  )}
                </div>
                {/* Now that scopes are chosen rather than implied, which ones a
                    key carries is the thing you need to see at a glance. */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {k.scopes.length > 0 ? (
                    k.scopes.map((s) => (
                      <span key={s} className="badge badge-muted font-mono">{s}</span>
                    ))
                  ) : (
                    <span className="text-xs text-subtle">no scopes — this key can’t do anything</span>
                  )}
                </div>
              </li>
            ))}
            {keys?.length === 0 && <li className="text-sm text-muted">No keys yet.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}

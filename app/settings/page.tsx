import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBuilding, faTrash, faArrowLeft, faKey } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';
import Brand from '@/components/Brand';
import { createOrg, revokeKey } from './actions';
import IssueKeyForm from './IssueKeyForm';

type KeyRow = {
  id: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export default async function SettingsPage() {
  const session = await getProfile();
  if (!session) redirect('/login');
  const { userId, profile } = session;

  const isRecruiter = profile.role === 'recruiter';
  const ownerId = isRecruiter ? profile.org_id : userId;
  const ownerType = isRecruiter ? 'org' : 'candidate';

  const db = createServiceClient();
  let org: { name: string } | null = null;
  if (isRecruiter && profile.org_id) {
    const { data } = await db.from('organizations').select('name').eq('id', profile.org_id).maybeSingle();
    org = data;
  }
  const { data: keys } = ownerId
    ? await db
        .from('api_keys')
        .select('id, key_prefix, scopes, created_at, last_used_at, revoked_at')
        .eq('owner_type', ownerType)
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false })
    : { data: [] as KeyRow[] };

  return (
    <main className="min-h-dvh">
      <nav className="max-w-2xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <div>
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1.5">
            <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-2">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">
            {profile.email} · <span className="badge badge-muted capitalize">{profile.role}</span>
          </p>
        </div>

        {/* Organization / recruiter onboarding */}
        <section className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faBuilding} className="w-4 h-4 text-sky-700" />
            Organization
          </h2>
          {isRecruiter ? (
            <p className="text-sm text-slate-600">
              You’re a recruiter at <span className="font-semibold text-slate-900">{org?.name ?? 'your org'}</span>.
              Manage jobs and evaluations from the{' '}
              <Link href="/recruiter" className="text-sky-700 hover:underline font-medium">recruiter dashboard</Link>.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-600 mb-3">
                Create an organization to post jobs and evaluate candidates. This makes you a recruiter.
              </p>
              <form action={createOrg} className="flex gap-2">
                <input type="text" name="name" required placeholder="Acme Inc." className="field flex-1" />
                <button type="submit" className="btn btn-primary">Create</button>
              </form>
            </>
          )}
        </section>

        {/* API keys */}
        <section className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
            <FontAwesomeIcon icon={faKey} className="w-4 h-4 text-sky-700" /> API keys
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            {isRecruiter
              ? 'Org keys let your agents pull submissions and trigger evaluations at scale.'
              : 'Candidate keys let you list tasks and submit programmatically.'}
          </p>

          {isRecruiter && !profile.org_id ? (
            <p className="text-sm text-amber-700">Create an organization first.</p>
          ) : (
            <IssueKeyForm />
          )}

          <ul className="mt-5 space-y-2">
            {(keys as KeyRow[] | null)?.map((k) => (
              <li key={k.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <code className="text-xs font-mono text-slate-700">{k.key_prefix}…</code>
                  <span className="badge badge-muted">{k.scopes.length} scopes</span>
                  {k.revoked_at && <span className="badge badge-danger">revoked</span>}
                </div>
                {!k.revoked_at && (
                  <form action={revokeKey}>
                    <input type="hidden" name="id" value={k.id} />
                    <button type="submit" className="text-slate-400 hover:text-red-600 cursor-pointer" title="Revoke">
                      <FontAwesomeIcon icon={faTrash} className="w-3.5 h-3.5" />
                    </button>
                  </form>
                )}
              </li>
            ))}
            {keys?.length === 0 && <li className="text-sm text-slate-500">No keys yet.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}

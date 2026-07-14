import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBriefcase, faListCheck, faGear } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import SignOutButton from '@/components/SignOutButton';

export default async function DashboardPage() {
  const session = await getProfile();
  if (!session) redirect('/login');
  const { profile } = session;
  const isRecruiter = profile.role === 'recruiter';

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">powagent</h1>
            <p className="text-sm text-zinc-500">
              {profile.email} · <span className="font-mono">{profile.role}</span>
            </p>
          </div>
          <SignOutButton />
        </header>

        <div className="grid gap-3">
          {isRecruiter ? (
            <Link href="/recruiter" className="rounded-xl border border-zinc-200 p-5 hover:border-violet-300 transition-colors">
              <div className="flex items-center gap-3">
                <FontAwesomeIcon icon={faBriefcase} className="w-4 h-4 text-violet-600" />
                <span className="font-semibold">Recruiter dashboard</span>
              </div>
              <p className="text-sm text-zinc-600 mt-1">Post jobs & tasks, manage rubrics, evaluate submissions.</p>
            </Link>
          ) : (
            <Link href="/tasks" className="rounded-xl border border-zinc-200 p-5 hover:border-violet-300 transition-colors">
              <div className="flex items-center gap-3">
                <FontAwesomeIcon icon={faListCheck} className="w-4 h-4 text-violet-600" />
                <span className="font-semibold">Browse tasks</span>
              </div>
              <p className="text-sm text-zinc-600 mt-1">Find open work samples, submit your result + agent transcript.</p>
            </Link>
          )}

          <Link href="/settings" className="rounded-xl border border-zinc-200 p-5 hover:border-violet-300 transition-colors">
            <div className="flex items-center gap-3">
              <FontAwesomeIcon icon={faGear} className="w-4 h-4 text-violet-600" />
              <span className="font-semibold">Settings & API keys</span>
            </div>
            <p className="text-sm text-zinc-600 mt-1">
              {isRecruiter ? 'Your organization and org API keys.' : 'Become a recruiter, or get a candidate API key.'}
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}

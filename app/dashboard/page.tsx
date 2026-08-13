import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBriefcase, faListCheck, faGear, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import Brand from '@/components/Brand';
import SignOutButton from '@/components/SignOutButton';

export default async function DashboardPage() {
  const session = await getProfile();
  if (!session) redirect('/login');
  const { profile } = session;
  const isRecruiter = profile.role === 'recruiter';

  const primary = isRecruiter
    ? { href: '/recruiter', icon: faBriefcase, title: 'Recruiter dashboard', body: 'Post jobs & tasks, manage rubrics, evaluate submissions.' }
    : { href: '/tasks', icon: faListCheck, title: 'Browse tasks', body: 'Find open work samples, submit your result + agent transcript.' };

  return (
    <main className="min-h-dvh">
      <nav className="max-w-3xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
        <div className="flex items-center gap-3">
          <span className="badge badge-muted capitalize">{profile.role}</span>
          <SignOutButton />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Welcome back
        </h1>
        <p className="text-sm text-muted mt-1">{profile.email}</p>

        <div className="grid gap-3 mt-6 sm:grid-cols-2">
          <Link href={primary.href} className="card-link p-6 sm:col-span-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-accent-soft text-accent">
                  <FontAwesomeIcon icon={primary.icon} className="w-4 h-4" />
                </span>
                <span className="font-semibold text-ink">{primary.title}</span>
              </div>
              <FontAwesomeIcon icon={faArrowRight} className="w-4 h-4 text-subtle mt-3" />
            </div>
            <p className="text-sm text-muted mt-3">{primary.body}</p>
          </Link>

          <Link href="/settings" className="card-link p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-elevated text-ink-soft">
                <FontAwesomeIcon icon={faGear} className="w-4 h-4" />
              </span>
              <span className="font-semibold text-ink">Settings & API keys</span>
            </div>
            <p className="text-sm text-muted">
              {isRecruiter ? 'Your organization and org API keys.' : 'Become a recruiter, or get a candidate API key.'}
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}

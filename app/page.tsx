import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRight, faBriefcase, faRobot, faChartLine } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/server';
import Brand from '@/components/Brand';

const steps = [
  { icon: faBriefcase, title: 'Post a task', body: 'Recruiters publish real, AI-agent-completable work with a scoring rubric.' },
  { icon: faRobot, title: 'Submit the work', body: 'Candidates do the task with their own agent and submit the result + transcript.' },
  { icon: faChartLine, title: 'Evaluate the process', body: 'The runtime scores how they actually worked — not a résumé.' },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-dvh">
      <nav className="max-w-5xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand />
        <Link href={user ? '/dashboard' : '/login'} className="btn btn-ghost btn-sm">
          {user ? 'Dashboard' : 'Sign in'}
        </Link>
      </nav>

      <section className="max-w-3xl mx-auto text-center px-6 pt-20 pb-16">
        <span className="badge badge-accent mb-5">AI-native hiring</span>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
          Hire on how people
          <br className="hidden sm:block" /> actually work.
        </h1>
        <p className="text-lg text-slate-600 mt-5 max-w-xl mx-auto">
          powagent evaluates real work samples — the candidate’s output <em>and</em> their agent
          conversation — against your own rubric. Judge the process, not the paperwork.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <Link href={user ? '/dashboard' : '/login'} className="btn btn-primary">
            {user ? 'Open dashboard' : 'Get started'}
            <FontAwesomeIcon icon={faArrowRight} className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="card p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-sky-50 text-sky-700">
                  <FontAwesomeIcon icon={s.icon} className="w-4 h-4" />
                </span>
                <span className="text-xs font-mono text-slate-400">0{i + 1}</span>
              </div>
              <h3 className="font-semibold text-slate-900">{s.title}</h3>
              <p className="text-sm text-slate-600 mt-1">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

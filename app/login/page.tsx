'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEnvelope, faCheck } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/client';
import Brand from '@/components/Brand';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setErr(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSubmitting(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 gap-6">
      {/* Without this there is no way out of /login except the back button. */}
      <Brand />
      <div className="w-full max-w-sm card p-8">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-accent-soft text-accent mb-5">
          <FontAwesomeIcon icon={sent ? faCheck : faEnvelope} className="w-4 h-4" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink mb-2">
          {sent ? 'Check your email' : 'Sign in to powagent'}
        </h1>
        <p className="text-sm text-muted mb-6">
          {sent
            ? `We sent a magic link to ${email}. Click it to sign in.`
            : 'Enter your email — we’ll send you a magic link.'}
        </p>

        {!sent && (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field h-11"
            />
            {err && (
              <p className="text-sm text-danger">{err}</p>
            )}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="btn btn-primary w-full h-11"
            >
              {submitting ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

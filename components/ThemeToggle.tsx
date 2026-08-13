'use client';

import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSun, faMoon, faCircleHalfStroke } from '@fortawesome/free-solid-svg-icons';

/**
 * Theme control. Three states, not two: without an explicit "system" option
 * there is no way back to following the OS once you have touched the button.
 *
 * The whole mechanism is one attribute. globals.css resolves every colour with
 * light-dark(), so narrowing `color-scheme` — which is all `data-theme` does —
 * is enough to repaint the app. No class lists, no duplicated palette, and
 * nothing for a component to opt into.
 *
 * `system` removes the attribute rather than writing a value, so the CSS falls
 * back to `color-scheme: light dark` and tracks the OS live, including a change
 * made while the tab is open.
 */

export const THEME_STORAGE_KEY = 'powagent-theme';

type Mode = 'system' | 'light' | 'dark';

const ORDER: Mode[] = ['system', 'light', 'dark'];

const META: Record<Mode, { icon: typeof faSun; label: string }> = {
  system: { icon: faCircleHalfStroke, label: 'Theme: system' },
  light: { icon: faSun, label: 'Theme: light' },
  dark: { icon: faMoon, label: 'Theme: dark' },
};

const apply = (mode: Mode) => {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
};

export default function ThemeToggle() {
  // Start at 'system' on both server and first client render so the markup
  // matches; the stored value is read in an effect, after hydration.
  const [mode, setMode] = useState<Mode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Private mode / storage disabled — fall through to system.
    }
    if (stored === 'light' || stored === 'dark') setMode(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    apply(mode);
    try {
      if (mode === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Not being able to persist is not a reason to refuse to switch.
    }
  }, [mode, ready]);

  const next = () => setMode((m) => ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]);
  const { icon, label } = META[mode];

  return (
    <button
      type="button"
      onClick={next}
      title={`${label} — click to change`}
      aria-label={`${label}. Click to switch theme.`}
      className="btn btn-ghost btn-sm fixed z-50 bottom-[max(1rem,env(safe-area-inset-bottom))]
                 right-[max(1rem,env(safe-area-inset-right))] w-9 px-0 rounded-full shadow-lg"
    >
      <FontAwesomeIcon icon={icon} className="w-3.5 h-3.5" />
    </button>
  );
}

'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';

/**
 * Light/dark switch. The theme itself is a single `dark` class on <html>,
 * written before first paint by the inline script in app/layout.tsx — this
 * button only flips it and records the choice.
 *
 * Both icons are rendered and one is hidden by the `dark:` variant, rather
 * than picking one in JS. The server has no way to know which theme the
 * browser will resolve, so choosing in JS means either a hydration mismatch
 * or a frame of the wrong icon; letting CSS choose means the markup is
 * theme-independent and correct from the very first paint.
 *
 * The hiding sits on a wrapping <span>, not on the icon: FontAwesome's
 * stylesheet is imported after globals.css and sets `display` on the svg
 * itself, so `hidden` on the icon loses to it and both icons show.
 */
export default function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.classList.contains('dark') ? 'light' : 'dark';
    root.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost btn-sm w-9 px-0"
      aria-label="Toggle light or dark theme"
      title="Toggle light or dark theme"
    >
      <span className="hidden dark:inline-flex">
        <FontAwesomeIcon icon={faSun} className="w-3.5 h-3.5" />
      </span>
      <span className="inline-flex dark:hidden">
        <FontAwesomeIcon icon={faMoon} className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

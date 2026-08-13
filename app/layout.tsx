import type { Metadata } from 'next';
import './globals.css';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';

// Tell FA not to inject CSS twice — we import the stylesheet manually above.
config.autoAddCss = false;

export const metadata: Metadata = {
  title: 'powagent',
  description: 'AI-native work-sample hiring platform',
};

/**
 * Applies the saved theme before the browser paints anything.
 *
 * This has to be a blocking inline script, not a React effect: an effect runs
 * after hydration, so a user who chose dark would get a flash of the light
 * theme on every navigation. Falls back to the OS preference when the user has
 * never chosen; wrapped in try/catch because reading localStorage throws in
 * some privacy modes, and a throw here would run before anything else on the
 * page. Kept in sync with components/ThemeToggle.tsx, which writes the key.
 */
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The script above edits <html>'s class before React hydrates, which React
    // would otherwise report as a server/client mismatch.
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}

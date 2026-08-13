import type { Metadata } from 'next';
import './globals.css';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import ThemeToggle, { THEME_STORAGE_KEY } from '@/components/ThemeToggle';

// Tell FA not to inject CSS twice — we import the stylesheet manually above.
config.autoAddCss = false;

export const metadata: Metadata = {
  title: 'powagent',
  description: 'AI-native work-sample hiring platform',
};

/**
 * Runs before first paint, so a stored preference is applied while the page is
 * still blank rather than as a visible flash after hydration. It is inline for
 * exactly that reason — an external file would be one round trip too late. Kept
 * to a single statement, reads nothing but its own key, and swallows the throw
 * localStorage produces when storage is blocked.
 *
 * Permitted by the CSP in next.config.ts, which already allows 'unsafe-inline'
 * for scripts.
 */
const noFlashScript = `try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(m==='light'||m==='dark'){document.documentElement.setAttribute('data-theme',m)}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The script above sets data-theme before React hydrates, which is a
    // deliberate server/client difference on <html>.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="antialiased">
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}

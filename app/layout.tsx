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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

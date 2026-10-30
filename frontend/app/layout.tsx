import type { Metadata } from 'next';
import { Public_Sans } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

export const metadata: Metadata = {
  title: 'Interhuman YC Booth',
  description: 'Practice your pitch with Garry Tan — real-time social signal analysis',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};

const publicSans = Public_Sans({
  variable: '--font-public-sans',
  subsets: ['latin'],
});

const commitMono = localFont({
  src: [
    { path: './fonts/CommitMono-400-Regular.otf', weight: '400', style: 'normal' },
    { path: './fonts/CommitMono-700-Regular.otf', weight: '700', style: 'normal' },
    { path: './fonts/CommitMono-400-Italic.otf', weight: '400', style: 'italic' },
    { path: './fonts/CommitMono-700-Italic.otf', weight: '700', style: 'italic' },
  ],
  variable: '--font-commit-mono',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark scroll-smooth">
      <body className={`${publicSans.variable} ${commitMono.variable} overflow-x-hidden antialiased`}>
        {children}
      </body>
    </html>
  );
}

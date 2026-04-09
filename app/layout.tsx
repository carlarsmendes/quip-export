import './globals.css';
import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body'
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-heading'
});

export const metadata: Metadata = {
  title: 'Quip Folder Exporter',
  description: 'Export Quip folder contents to DOCX files in a ZIP.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${plusJakartaSans.variable}`}>{children}</body>
    </html>
  );
}

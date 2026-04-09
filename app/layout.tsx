import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quip Folder Exporter',
  description: 'Export Quip folder contents to DOCX files in a ZIP.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

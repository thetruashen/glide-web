import type { Metadata } from 'next';
import './globals.css';
import './launcher.css';
export const metadata: Metadata = { title: 'Glide · Your world, anywhere', description: 'A private Minecraft launcher in your browser. Local worlds, remote play.' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

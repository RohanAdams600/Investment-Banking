import Link from 'next/link';
import { brand } from '@ib/core';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1 text-center">
          <Link href="/" className="font-display text-2xl font-semibold">
            {brand.name}
          </Link>
          <p className="text-text-muted text-sm">{brand.tagline}</p>
        </div>

        {children}
      </div>
    </div>
  );
}

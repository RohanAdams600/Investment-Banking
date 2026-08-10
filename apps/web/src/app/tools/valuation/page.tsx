import type { Metadata } from 'next';

import { ValuationForm } from '@/features/valuation/valuation-form';

export const metadata: Metadata = {
  title: 'Valuation estimate',
  description: 'An indicative valuation range for discussion, with the assumptions shown.',
};

export default function ValuationPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">What might your business be worth?</h1>
        <p className="text-text-secondary max-w-2xl text-sm">
          A transparent multiple-of-earnings model. Every adjustment it applies is shown, and the
          range moves as you change the inputs — so you can see which facts about your business are
          doing the work, and argue with them.
        </p>
      </header>

      <ValuationForm />
    </main>
  );
}

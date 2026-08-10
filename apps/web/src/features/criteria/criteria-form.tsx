'use client';

import { useState } from 'react';
import { AIDisclaimer, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@ib/ui';
import { INDUSTRY_PROFILES } from '@ib/core';

import { saveCriteria } from './actions';
import { emptyCriteriaState, US_STATES, type CriteriaFormState } from './types';

/**
 * Buyer acquisition criteria intake.
 *
 * Two kinds of question, kept visually separate because they behave
 * differently:
 *
 *   **Preferences** shape the ranking. A listing outside them still appears,
 *   scored lower.
 *   **Hard limits** exclude. A listing that breaches one is not shown at all.
 *
 * Conflating them is how a buyer ends up either drowning in irrelevant deals or
 * silently never seeing something they would have wanted. The form says which
 * is which, because a buyer setting "max customer concentration 40%" should know
 * they will never be shown the business at 45%.
 */

const INDUSTRY_OPTIONS = Object.values(INDUSTRY_PROFILES);

export function CriteriaForm({ initial }: { initial?: CriteriaFormState }) {
  const [form, setForm] = useState<CriteriaFormState>(initial ?? emptyCriteriaState);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ error: string | null; notice: string | null }>({
    error: null,
    notice: null,
  });

  const set = <K extends keyof CriteriaFormState>(key: K, value: CriteriaFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggle = <K extends 'industries' | 'jurisdictions'>(key: K, value: string) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus({ error: null, notice: null });

    const result = await saveCriteria(form);
    setStatus(result);
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What are you looking for?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-text-primary text-sm font-medium">Industries</legend>
            <p className="text-text-muted text-xs">
              Leave all unchecked if you are open to any sector. That is different from checking
              every box — an open search does not favour any one industry.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {INDUSTRY_OPTIONS.map((option) => (
                <label key={option.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.industries.includes(option.key)}
                    onChange={() => toggle('industries', option.key)}
                    className="border-border-default text-primary focus-visible:ring-ring mt-0.5 h-4 w-4 rounded"
                  />
                  <span className="text-text-secondary">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-text-primary text-sm font-medium">States</legend>
            <p className="text-text-muted text-xs">Leave empty for anywhere in the US.</p>
            <div className="border-border-subtle max-h-40 overflow-y-auto rounded border p-2">
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
                {US_STATES.map((state) => (
                  <label key={state.code} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={form.jurisdictions.includes(state.code)}
                      onChange={() => toggle('jurisdictions', state.code)}
                      className="h-3.5 w-3.5 rounded"
                    />
                    <span className="text-text-secondary">{state.abbr}</span>
                  </label>
                ))}
              </div>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Minimum revenue (USD)"
              numeric
              inputMode="decimal"
              value={form.revenueMin}
              onChange={(e) => set('revenueMin', e.target.value)}
              placeholder="1,000,000"
            />
            <Input
              label="Maximum revenue (USD)"
              numeric
              inputMode="decimal"
              value={form.revenueMax}
              onChange={(e) => set('revenueMax', e.target.value)}
              placeholder="10,000,000"
            />
            <Input
              label="Minimum earnings (USD)"
              numeric
              inputMode="decimal"
              value={form.earningsMin}
              onChange={(e) => set('earningsMin', e.target.value)}
              placeholder="250,000"
              hint="SDE or EBITDA, whichever the sector uses."
            />
            <Input
              label="Maximum earnings (USD)"
              numeric
              inputMode="decimal"
              value={form.earningsMax}
              onChange={(e) => set('earningsMax', e.target.value)}
              placeholder="2,000,000"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="dealStructure"
                className="text-text-primary block text-sm font-medium"
              >
                Deal structure
              </label>
              <select
                id="dealStructure"
                value={form.dealStructure}
                onChange={(e) =>
                  set('dealStructure', e.target.value as CriteriaFormState['dealStructure'])
                }
                className="border-border-default bg-surface text-text-primary focus-visible:ring-ring h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
              >
                <option value="either">Either</option>
                <option value="asset">Asset purchase</option>
                <option value="stock">Stock purchase</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="involvement" className="text-text-primary block text-sm font-medium">
                Your involvement
              </label>
              <select
                id="involvement"
                value={form.involvement}
                onChange={(e) =>
                  set('involvement', e.target.value as CriteriaFormState['involvement'])
                }
                className="border-border-default bg-surface text-text-primary focus-visible:ring-ring h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
              >
                <option value="either">Either</option>
                <option value="owner_operator">I will run it myself</option>
                <option value="passive">I want existing management to stay</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hard limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-text-secondary text-sm">
            Unlike the preferences above, anything breaching these is{' '}
            <strong className="text-text-primary">hidden entirely</strong> rather than ranked lower.
            Leave blank unless you mean it.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Maximum deal size (USD)"
              numeric
              inputMode="decimal"
              value={form.dealSizeMax}
              onChange={(e) => set('dealSizeMax', e.target.value)}
              placeholder="5,000,000"
              hint="Including any debt you would raise."
            />
            <Input
              label="Max customer concentration, %"
              numeric
              inputMode="decimal"
              value={form.maxCustomerConcentration}
              onChange={(e) => set('maxCustomerConcentration', e.target.value)}
              placeholder="40"
              hint="Largest single customer as a share of revenue."
            />
            <Input
              label="Min recurring revenue, %"
              numeric
              inputMode="decimal"
              value={form.minRecurringRevenueShare}
              onChange={(e) => set('minRecurringRevenueShare', e.target.value)}
              placeholder="30"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your thesis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="thesis" className="sr-only">
            Acquisition thesis
          </label>
          <textarea
            id="thesis"
            value={form.thesis}
            onChange={(e) => set('thesis', e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder="What are you actually trying to buy, and why? Free text — the more specific, the better the matches."
            className="border-border-default bg-surface text-text-primary placeholder:text-text-muted focus-visible:ring-ring w-full resize-y rounded border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />

          {/*
            The thesis is the only field an AI model reads. The numeric criteria
            above drive deterministic scoring, and saying so matters: a buyer
            should know which of their answers are arithmetic and which are
            interpretation.
          */}
          <AIDisclaimer variant="match" layout="inline">
            Your numeric criteria are applied exactly as entered. Only this free-text thesis is
            interpreted by a model, and only to rank listings you would already have seen.
          </AIDisclaimer>
        </CardContent>
      </Card>

      {status.error ? (
        <p role="alert" className="text-danger text-sm">
          {status.error}
        </p>
      ) : null}
      {status.notice ? (
        <p role="status" className="text-success text-sm">
          {status.notice}
        </p>
      ) : null}

      <Button type="submit" loading={saving}>
        Save criteria
      </Button>
    </form>
  );
}

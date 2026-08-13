'use client';

import { useMemo, useState, useTransition } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  AIDisclaimer,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@ib/ui';
import {
  estimateValuation,
  valueAllMethods,
  formatMoney,
  INDUSTRY_PROFILES,
  ValuationInputError,
  type IndustryKey,
  type MultiMethodValuation,
  type ValuationResult,
} from '@ib/core';

import { MethodsPanel } from './methods-panel';
import { saveValuation } from './actions';
import { emptySaveState, type SaveValuationState } from './types';

/**
 * Valuation intake and result.
 *
 * The whole calculation runs in the browser, on every keystroke. That is a
 * deliberate consequence of the model being deterministic arithmetic rather
 * than an AI call: the assumptions are editable and the range moves as you edit
 * them, which is exactly what the specification asks for and what makes the
 * output feel like a model rather than a pronouncement.
 *
 * Nothing is persisted unless the seller explicitly saves. Someone exploring
 * what their business might be worth is doing something private, and it should
 * not silently become a record.
 */

const INDUSTRY_OPTIONS = Object.values(INDUSTRY_PROFILES);

interface FormState {
  industry: IndustryKey;
  revenue: string;
  earnings: string;
  customerConcentration: string;
  recurringRevenueShare: string;
  revenueGrowth: string;
  yearsInBusiness: string;
  ownerDependence: '' | 'absentee' | 'moderate' | 'critical';
  /** Asset figures, which set a floor under the other methods. */
  tangibleAssets: string;
  inventory: string;
  liabilities: string;
}

const EMPTY: FormState = {
  industry: 'home_services',
  revenue: '',
  earnings: '',
  customerConcentration: '',
  recurringRevenueShare: '',
  revenueGrowth: '',
  yearsInBusiness: '',
  ownerDependence: '',
  tangibleAssets: '',
  inventory: '',
  liabilities: '',
};

/** Dollars in the field, integer cents in the model. */
function toCents(value: string): number | undefined {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (cleaned === '') return undefined;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars)) return undefined;
  return Math.round(dollars * 100);
}

function toFraction(value: string): number | undefined {
  const cleaned = value.replace(/[^0-9.\-]/g, '');
  if (cleaned === '') return undefined;
  const percent = Number(cleaned);
  if (!Number.isFinite(percent)) return undefined;
  return percent / 100;
}

export function ValuationForm() {
  const [form, setForm] = useState<FormState>(EMPTY);

  const profile = INDUSTRY_PROFILES[form.industry];

  const { result, error } = useMemo((): {
    result: ValuationResult | null;
    error: string | null;
  } => {
    const revenue = toCents(form.revenue);
    const earnings = toCents(form.earnings);

    if (revenue === undefined || earnings === undefined) {
      return { result: null, error: null };
    }

    try {
      return {
        result: estimateValuation({
          industry: form.industry,
          revenue,
          ...(profile.basis === 'sde' ? { sde: earnings } : { ebitda: earnings }),
          customerConcentration: toFraction(form.customerConcentration),
          recurringRevenueShare: toFraction(form.recurringRevenueShare),
          revenueGrowth: toFraction(form.revenueGrowth),
          yearsInBusiness: form.yearsInBusiness ? Number(form.yearsInBusiness) : undefined,
          ownerDependence: form.ownerDependence === '' ? undefined : form.ownerDependence,
        }),
        error: null,
      };
    } catch (thrown) {
      // The model refuses loss-making businesses rather than guessing. That
      // refusal is information, so it is shown rather than swallowed.
      return {
        result: null,
        error: thrown instanceof ValuationInputError ? thrown.message : 'Could not calculate.',
      };
    }
  }, [form, profile.basis]);

  /**
   * The same inputs, valued every way that applies.
   *
   * Computed separately from `result` rather than replacing it: the earnings
   * method stays the primary answer with its itemised adjustments, and this
   * adds the cross-checks. It also covers the case `result` cannot — a business
   * at or below break-even, where the single-method engine refuses and the
   * seller is left with an error where a number should be.
   */
  const methods = useMemo((): MultiMethodValuation | null => {
    const revenue = toCents(form.revenue);
    const earnings = toCents(form.earnings);
    if (revenue === undefined || earnings === undefined) return null;

    return valueAllMethods({
      industry: form.industry,
      revenue,
      ...(profile.basis === 'sde' ? { sde: earnings } : { ebitda: earnings }),
      customerConcentration: toFraction(form.customerConcentration),
      recurringRevenueShare: toFraction(form.recurringRevenueShare),
      revenueGrowth: toFraction(form.revenueGrowth),
      yearsInBusiness: form.yearsInBusiness ? Number(form.yearsInBusiness) : undefined,
      ownerDependence: form.ownerDependence === '' ? undefined : form.ownerDependence,
      tangibleAssets: toCents(form.tangibleAssets),
      inventory: toCents(form.inventory),
      liabilities: toCents(form.liabilities),
    });
  }, [form, profile.basis]);

  const [saveState, setSaveState] = useState<SaveValuationState>(emptySaveState);
  const [saving, startSaving] = useTransition();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function handleSave() {
    const revenue = toCents(form.revenue);
    const earnings = toCents(form.earnings);
    if (revenue === undefined || earnings === undefined) return;

    setSaveState(emptySaveState);
    startSaving(async () => {
      // Only the raw inputs are sent. The server recalculates the range from
      // them rather than trusting numbers this component computed.
      setSaveState(
        await saveValuation({
          industry: form.industry,
          revenueCents: revenue,
          earningsCents: earnings,
          customerConcentration: toFraction(form.customerConcentration),
          recurringRevenueShare: toFraction(form.recurringRevenueShare),
          revenueGrowth: toFraction(form.revenueGrowth),
          yearsInBusiness: form.yearsInBusiness ? Number(form.yearsInBusiness) : undefined,
          ownerDependence: form.ownerDependence === '' ? undefined : form.ownerDependence,
        }),
      );
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Your business</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="industry" className="text-text-primary block text-sm font-medium">
              Industry
            </label>
            <select
              id="industry"
              value={form.industry}
              onChange={(e) => set('industry', e.target.value as IndustryKey)}
              className="border-border-default bg-surface text-text-primary focus-visible:ring-ring h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
            >
              {INDUSTRY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-text-muted text-xs">{profile.rationale}</p>
          </div>

          <Input
            label="Annual revenue (USD)"
            numeric
            inputMode="decimal"
            value={form.revenue}
            onChange={(e) => set('revenue', e.target.value)}
            placeholder="2,500,000"
          />

          <Input
            label={
              profile.basis === 'sde' ? 'Seller’s discretionary earnings (USD)' : 'EBITDA (USD)'
            }
            numeric
            inputMode="decimal"
            value={form.earnings}
            onChange={(e) => set('earnings', e.target.value)}
            placeholder="500,000"
            hint={
              profile.basis === 'sde'
                ? 'Profit plus one owner’s salary and personal expenses run through the business.'
                : 'Earnings before interest, tax, depreciation and amortisation.'
            }
          />

          <div className="border-border-subtle space-y-4 border-t pt-4">
            <p className="text-text-secondary text-sm font-medium">
              Optional — each of these narrows the range
            </p>

            <Input
              label="Largest customer, % of revenue"
              numeric
              inputMode="decimal"
              value={form.customerConcentration}
              onChange={(e) => set('customerConcentration', e.target.value)}
              placeholder="15"
              hint="The single biggest driver of the estimate."
            />

            <Input
              label="Recurring or contracted revenue, %"
              numeric
              inputMode="decimal"
              value={form.recurringRevenueShare}
              onChange={(e) => set('recurringRevenueShare', e.target.value)}
              placeholder="40"
            />

            <Input
              label="Revenue growth last year, %"
              numeric
              inputMode="decimal"
              value={form.revenueGrowth}
              onChange={(e) => set('revenueGrowth', e.target.value)}
              placeholder="8"
              hint="Use a negative number for a decline."
            />

            <Input
              label="Equipment and vehicles"
              numeric
              inputMode="decimal"
              value={form.tangibleAssets}
              onChange={(e) => set('tangibleAssets', e.target.value)}
              placeholder="300000"
              hint="What a buyer would pay to replace them. Sets a floor under the estimate."
            />

            <Input
              label="Inventory at cost"
              numeric
              inputMode="decimal"
              value={form.inventory}
              onChange={(e) => set('inventory', e.target.value)}
              placeholder="50000"
            />

            <Input
              label="Debt that transfers with the business"
              numeric
              inputMode="decimal"
              value={form.liabilities}
              onChange={(e) => set('liabilities', e.target.value)}
              placeholder="80000"
              hint="Netted off the asset figure. Leave blank if the buyer takes none."
            />

            <Input
              label="Years in business"
              numeric
              inputMode="numeric"
              value={form.yearsInBusiness}
              onChange={(e) => set('yearsInBusiness', e.target.value)}
              placeholder="12"
            />

            <div className="space-y-1.5">
              <label
                htmlFor="ownerDependence"
                className="text-text-primary block text-sm font-medium"
              >
                How much does the business depend on you?
              </label>
              <select
                id="ownerDependence"
                value={form.ownerDependence}
                onChange={(e) =>
                  set('ownerDependence', e.target.value as FormState['ownerDependence'])
                }
                className="border-border-default bg-surface text-text-primary focus-visible:ring-ring h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
              >
                <option value="">Not sure yet</option>
                <option value="absentee">It runs without me day to day</option>
                <option value="moderate">I am involved but not essential</option>
                <option value="critical">The business depends on me</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {/*
          Rendered above the numbers, not below them. A disclaimer under a large
          dollar figure is read after the figure has already landed.
        */}
        <AIDisclaimer variant="valuation" />

        {error ? (
          <Card>
            <CardContent className="flex gap-3 py-6">
              <AlertCircle aria-hidden className="text-warning mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-text-secondary text-sm">{error}</p>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <>
            <ValuationOutput result={result} />

            <Card>
              <CardContent className="space-y-3 py-4">
                <Button variant="secondary" onClick={handleSave} loading={saving}>
                  Save this estimate
                </Button>
                <p className="text-text-muted text-xs">
                  Saved estimates are private to you. Nothing is stored until you choose to save.
                </p>
                {saveState.error ? (
                  <p role="alert" className="text-danger text-sm">
                    {saveState.error}
                  </p>
                ) : null}
                {saveState.notice ? (
                  <p role="status" className="text-success text-sm">
                    {saveState.notice}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}

        {/*
          Rendered whenever there are inputs, including when the earnings
          method refused. That refusal used to leave the seller with nothing;
          the revenue and asset methods still say something a buyer would
          recognise.
        */}
        {methods ? <MethodsPanel valuation={methods} /> : null}

        {!methods ? (
          <Card>
            <CardContent className="text-text-muted py-8 text-center text-sm">
              Enter revenue and earnings to see an estimated range.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function ValuationOutput({ result }: { result: ValuationResult }) {
  const confidenceLabel = {
    low: 'Low confidence — several inputs missing',
    moderate: 'Moderate confidence',
    indicative: 'Indicative — as complete as this model gets',
  }[result.confidence];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle>Estimated range</CardTitle>
          <Badge variant={result.confidence === 'low' ? 'warning' : 'neutral'}>
            {result.confidence}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {/*
            A range, presented as a range. There is no midpoint shown and none
            in the model's output type — the moment a single figure exists it
            becomes the number people quote.
          */}
          <p className="font-tabular text-3xl">
            {formatMoney(result.range.low)}
            <span className="text-text-muted mx-2 text-xl">to</span>
            {formatMoney(result.range.high)}
          </p>

          <p className="text-text-muted text-sm">
            {result.effectiveMultipleLow}× to {result.effectiveMultipleHigh}×{' '}
            {result.basis === 'sde' ? 'SDE' : 'EBITDA'} of {formatMoney(result.earnings)}. The
            sector starts at {result.baseMultipleLow}×–{result.baseMultipleHigh}×.
          </p>

          <p className="text-text-muted text-xs">{confidenceLabel}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What moved the range</CardTitle>
        </CardHeader>
        <CardContent>
          {result.factors.length === 0 ? (
            <p className="text-text-muted text-sm">
              Nothing yet — the range is the sector baseline. Fill in the optional fields to adjust
              it.
            </p>
          ) : (
            <ul className="divide-border-subtle divide-y">
              {result.factors.map((factor) => (
                <li key={factor.label} className="flex gap-3 py-3">
                  <span
                    className={`font-tabular w-14 shrink-0 text-sm ${
                      factor.direction === 'positive'
                        ? 'text-success'
                        : factor.direction === 'negative'
                          ? 'text-danger'
                          : 'text-text-muted'
                    }`}
                  >
                    {factor.multipleDelta > 0 ? '+' : ''}
                    {factor.multipleDelta.toFixed(2)}×
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{factor.label}</span>
                    <span className="text-text-muted block text-xs">{factor.explanation}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {result.missingInputs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What would sharpen this</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-text-secondary list-disc space-y-1 pl-5 text-sm">
              {result.missingInputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

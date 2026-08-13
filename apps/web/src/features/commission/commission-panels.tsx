'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { FEE_STRUCTURES, calculateCommission, formatMoney, type FeeStructure } from '@ib/core';
import {
  AIDisclaimer,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@ib/ui';

import { recordCommission, saveFeeAgreement, updateCommissionStatus } from './actions';
import { emptyCommissionState } from './actions';
import type { CommissionTotals, StoredAgreement, StoredCommission } from './queries';

/**
 * The firm's fee schedule.
 *
 * Saving supersedes rather than edits, so a fee computed last quarter stays
 * explicable under the terms that produced it. The preview underneath is the
 * point of the form: a schedule is abstract until you see what it charges on a
 * real deal size, and getting that wrong is expensive in both directions.
 */
export function FeeScheduleForm({
  firmId,
  agreement,
}: {
  firmId: string;
  agreement: StoredAgreement | null;
}) {
  const [state, action] = useActionState(saveFeeAgreement, emptyCommissionState);

  const percent = (fraction: number | null): string =>
    fraction === null ? '' : String(Math.round(fraction * 10_000) / 100);
  const dollars = (cents: number | null): string => (cents === null ? '' : String(cents / 100));

  return (
    <form action={action}>
      <input type="hidden" name="firmId" value={firmId} />

      <Card>
        <CardHeader>
          <CardTitle>Fee schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Structure"
            name="structure"
            defaultValue={agreement?.structure ?? 'double_lehman'}
            hint="Lehman schedules are marginal — each rate applies only to that slice of the price, not the whole."
          >
            {FEE_STRUCTURES.filter((s) => s.value !== 'tiered').map((structure) => (
              <option key={structure.value} value={structure.value}>
                {structure.label}
              </option>
            ))}
          </Select>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Flat rate, %"
              name="flatRate"
              numeric
              inputMode="decimal"
              defaultValue={percent(agreement?.flatRate ?? null)}
              hint="Only used by the flat structure."
            />
            <Input
              label="Minimum fee"
              name="minimumFee"
              numeric
              inputMode="decimal"
              defaultValue={dollars(agreement?.minimumFeeCents ?? null)}
              hint="The floor under any success fee. This is what stops small deals losing money."
            />
            <Input
              label="Co-broker share, %"
              name="coBrokerShare"
              numeric
              inputMode="decimal"
              defaultValue={percent(agreement?.coBrokerShare ?? null)}
              hint="Of the whole fee, if another broker represents the buyer."
            />
            <Input
              label="Monthly retainer"
              name="retainer"
              numeric
              inputMode="decimal"
              defaultValue={dollars(agreement?.retainerCents ?? null)}
              hint="Recorded alongside; not netted off the success fee unless your agreement says so."
            />
          </div>

          {agreement ? <SchedulePreview agreement={agreement} /> : null}

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <p aria-live="polite" className="text-text-muted text-sm">
            {state.message}
          </p>

          <p className="text-text-muted text-xs">
            Saving keeps the previous schedule on record rather than replacing it, so a fee
            calculated under the old terms stays explicable.
          </p>

          <Submit label="Save schedule" />
        </CardContent>
      </Card>
    </form>
  );
}

/**
 * What the schedule actually charges.
 *
 * A rate table is abstract; "on a $2M sale this is $180,000" is not. Three
 * sizes spanning the market this platform serves, computed by the same function
 * that produces the real invoice.
 */
function SchedulePreview({ agreement }: { agreement: StoredAgreement }) {
  const sizes = [50_000_000, 200_000_000, 750_000_000];

  const spec = {
    structure: agreement.structure as FeeStructure,
    flatRate: agreement.flatRate ?? undefined,
    minimumFeeCents: agreement.minimumFeeCents ?? undefined,
    coBrokerShare: agreement.coBrokerShare ?? undefined,
  };

  const rows = sizes.map((price) => {
    try {
      const result = calculateCommission(spec, price);
      return { price, result };
    } catch {
      // A schedule that cannot be computed is a schedule that needs fixing, and
      // the form above is where that happens.
      return { price, result: null };
    }
  });

  return (
    <div className="border-border-subtle rounded border p-3">
      <h3 className="text-text-secondary mb-2 text-xs font-medium">What this charges</h3>
      <ul className="space-y-1">
        {rows.map(({ price, result }) => (
          <li key={price} className="flex justify-between gap-3 text-xs">
            <span className="text-text-muted">On {formatMoney(price)}</span>
            <span className="font-mono tabular-nums">
              {result === null ? '—' : formatMoney(result.totalFeeCents)}
              {result?.minimumApplied ? <span className="text-text-muted"> (minimum)</span> : null}
              {result ? (
                <span className="text-text-muted">
                  {' '}
                  · {(result.effectiveRate * 100).toFixed(1)}%
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Records a fee against a closing. */
export function RecordCommissionForm({ firmId }: { firmId: string }) {
  const [state, action] = useActionState(recordCommission, emptyCommissionState);

  return (
    <form action={action}>
      <input type="hidden" name="firmId" value={firmId} />

      <Card>
        <CardHeader>
          <CardTitle>Record a commission</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Sale price"
            name="salePrice"
            numeric
            inputMode="decimal"
            required
            placeholder="2000000"
            hint="The fee is calculated here from your schedule — the figure is never taken from the browser."
          />

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <p aria-live="polite" className="text-text-muted text-sm">
            {state.message}
          </p>

          <p className="text-text-muted text-xs">
            Recorded as projected. Mark it earned when the deal actually closes — a fee is owed on a
            closing, not on a form being submitted.
          </p>

          <Submit label="Record" />
        </CardContent>
      </Card>
    </form>
  );
}

/** The statement. */
export function CommissionStatement({
  records,
  totals,
}: {
  records: StoredCommission[];
  totals: CommissionTotals;
}) {
  const [state, action] = useActionState(updateCommissionStatus, emptyCommissionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commissions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Projected" value={formatMoney(totals.projectedCents)} />
          <Stat label="Earned" value={formatMoney(totals.earnedCents)} />
          <Stat label="Settled" value={formatMoney(totals.settledCents)} />
          <Stat label="Deals closed" value={String(totals.closedCount)} />
        </dl>

        <p className="text-text-muted text-xs">
          Totals are net of any co-broker split — what the firm keeps, not the gross fee.
        </p>

        {records.length === 0 ? (
          <p className="text-text-muted text-sm">
            Nothing recorded yet. Set a fee schedule above, then record a commission against a
            closing.
          </p>
        ) : (
          <ul className="space-y-3">
            {records.map((record) => (
              <li key={record.id} className="border-border-subtle border-b pb-3 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm tabular-nums">
                      {formatMoney(record.netFeeCents)}
                      {record.coBrokerFeeCents > 0 ? (
                        <span className="text-text-muted text-xs">
                          {' '}
                          net · {formatMoney(record.totalFeeCents)} gross
                        </span>
                      ) : null}
                    </p>
                    <p className="text-text-muted text-xs">
                      On a sale of {formatMoney(record.salePriceCents)}
                      {record.totalFeeCents > record.calculatedFeeCents
                        ? ' · minimum fee applied'
                        : ''}
                    </p>
                  </div>
                  <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
                </div>

                {record.bands.length > 0 ? (
                  <ul className="text-text-muted mt-2 space-y-0.5 text-xs">
                    {record.bands.map((band, index) => (
                      <li key={`${band.fromCents}-${index}`} className="flex justify-between gap-3">
                        <span>
                          {formatMoney(band.amountCents)} at {(band.rate * 100).toFixed(0)}%
                        </span>
                        <span className="font-mono tabular-nums">{formatMoney(band.feeCents)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {record.waivedReason ? (
                  <p className="text-text-secondary mt-2 text-xs">Waived: {record.waivedReason}</p>
                ) : null}

                {record.status === 'projected' || record.status === 'earned' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {record.status === 'projected' ? (
                      <form action={action}>
                        <input type="hidden" name="recordId" value={record.id} />
                        <input type="hidden" name="status" value="earned" />
                        <SmallButton label="Mark earned" />
                      </form>
                    ) : (
                      <form action={action}>
                        <input type="hidden" name="recordId" value={record.id} />
                        <input type="hidden" name="status" value="settled" />
                        <SmallButton label="Mark settled" />
                      </form>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {state.error ? (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        ) : null}

        <p aria-live="polite" className="text-text-muted text-sm">
          {state.message}
        </p>

        <p className="text-text-muted text-xs">
          &ldquo;Settled&rdquo; records that your firm considers the fee paid. Cairn does not move
          money and has no payment rail — it is your assertion, not a confirmation from a processor.
        </p>

        <AIDisclaimer variant="tax" />
      </CardContent>
    </Card>
  );
}

function statusVariant(
  status: StoredCommission['status'],
): 'neutral' | 'success' | 'info' | 'warning' {
  if (status === 'settled') return 'success';
  if (status === 'earned') return 'info';
  if (status === 'waived') return 'warning';
  return 'neutral';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-muted text-xs">{label}</dt>
      <dd className="font-mono text-lg tabular-nums">{value}</dd>
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

function SmallButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" loading={pending}>
      {label}
    </Button>
  );
}

'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@ib/ui';

import { createDeal } from './actions';
import { emptyDealState, type FirmOption } from './types';

export function NewDealForm({ firms }: { firms: FirmOption[] }) {
  const [state, action] = useActionState(createDeal, emptyDealState);

  return (
    <form action={action} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Open a deal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Deal name"
            name="name"
            required
            autoFocus
            placeholder="Project Anchor"
            hint="A codename is common — the deal name is visible to everyone you invite."
          />

          <Input
            label="First conversation"
            name="conversationName"
            defaultValue="Buyer and seller"
            required
            hint="Every deal starts with one room. You can add more later."
          />

          <div className="space-y-1.5">
            <label
              htmlFor="conversationType"
              className="text-text-primary block text-sm font-medium"
            >
              Room type
            </label>
            <select
              id="conversationType"
              name="conversationType"
              defaultValue="buyer_seller"
              className="border-border-default bg-surface text-text-primary focus-visible:ring-ring h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
            >
              <option value="buyer_seller">Buyer and seller</option>
              <option value="internal">Internal</option>
              <option value="diligence">Diligence</option>
            </select>
          </div>

          {firms.length > 0 ? (
            <div className="space-y-1.5">
              <label htmlFor="firmId" className="text-text-primary block text-sm font-medium">
                Attribute to a firm
              </label>
              <select
                id="firmId"
                name="firmId"
                defaultValue=""
                className="border-border-default bg-surface text-text-primary focus-visible:ring-ring h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
              >
                <option value="">No firm</option>
                {firms.map((firm) => (
                  <option key={firm.id} value={firm.id}>
                    {firm.name}
                  </option>
                ))}
              </select>
              <p className="text-text-muted text-xs">
                Only firms you belong to are listed, and the database checks it again.
              </p>
            </div>
          ) : null}

          <p className="text-text-muted text-sm">
            You will be seated in the first room as the banker, so you can bring the other side in.
            Nobody else can see this deal until you add them.
          </p>

          {state.error ? (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          ) : null}

          <SubmitButton />
        </CardContent>
      </Card>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      Open deal
    </Button>
  );
}

// @ts-check
/**
 * Checkout step 3 · Your details (designs: file 01, "3 · Your details" and its states:
 * field errors, seats ran out while filling in, an extra sold out, offline).
 * /irin-lagos-tours/lagos-island-heritage-walk/book/details
 *
 * "Continue to payment" is the moment the seats are HELD for 15 minutes and the booking is
 * created (status "held"). Before that: only "is anything missing?" is checked here; whether
 * a phone number or an age is valid is the server's answer, shown next to the field.
 * Everything typed is kept (checkout state), whatever happens.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { formatLocalDay } from '@okapigo/shared/preview';
import { ApiError, describeError } from '../../lib/api.js';
import { travellerSlots, missingFields, serverErrors, basketKey } from '../../lib/checkout.js';
import { holdAndBook } from '../../lib/checkout-actions.js';
import { useCheckout } from '../../lib/checkout-state.js';
import { TextField } from '../../components/TextField.jsx';
import { Notice } from '../../components/Feedback.jsx';
import { Bar } from '../../components/Skeleton.jsx';
import { ErrorState } from '../../components/ErrorState.jsx';
import { CheckoutFrame, useTourForCheckout } from './CheckoutFrame.jsx';

/** @param {{ params: { operator: string, tour: string } }} props */
export function Details({ params }) {
  const { operator: opSlug, tour: tourSlug } = params;
  const [, navigate] = useLocation();
  const { state, update } = useCheckout(opSlug, tourSlug);
  const { data: view, error: tourError, retry } = useTourForCheckout(opSlug, tourSlug);
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [problem, setProblem] = useState(/** @type {ApiError | null} */ (null));
  const [sending, setSending] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(Boolean(state.booking));

  // Nothing chosen yet (a bookmarked link): start at step 1.
  useEffect(() => {
    if (!state.departure) navigate(`/${opSlug}/${tourSlug}/book`, { replace: true });
  }, [state.departure, opSlug, tourSlug, navigate]);

  if (!view || !state.departure) {
    return (
      <div className="okg-page">
        {tourError ? <ErrorState error={tourError} onRetry={retry} /> : <Bar height={28} />}
      </div>
    );
  }

  const { operator, tour } = view;
  const slots = travellerSlots(state.counts, tour.priceCategories);
  // One form per traveller, keeping what was typed if counts changed in between.
  const travellers = slots.map(
    (_, i) => state.travellers[i] ?? { name: '', age: '', dietaryNeeds: '' },
  );
  const { lead } = state;
  const dateLine = `${formatLocalDay(state.departure.localDate)} · ${state.departure.localTime}`;
  const back = `/${opSlug}/${tourSlug}/book/who`;

  /** @param {Partial<typeof lead>} patch */
  const setLead = (patch) => update({ lead: { ...lead, ...patch } });
  /** @param {number} i @param {Partial<typeof travellers[0]>} patch */
  const setTraveller = (i, patch) =>
    update({ travellers: travellers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const travellingToo = Boolean(lead.name) && travellers[0]?.name === lead.name;

  const submit = async () => {
    setProblem(null);
    const missing = missingFields({ lead, travellers, acceptTerms });
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;

    const current = { ...state, travellers };
    // Nothing changed since the last hold: reuse that booking (step 4 checks it's still held).
    if (state.booking && state.booking.key === basketKey(current)) {
      navigate(`/${opSlug}/${tourSlug}/book/review`);
      return;
    }
    setSending(true);
    try {
      const booking = await holdAndBook(opSlug, current, slots);
      update({ travellers, booking });
      navigate(`/${opSlug}/${tourSlug}/book/review`);
    } catch (err) {
      const fields = err instanceof ApiError ? serverErrors(err) : {};
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setProblem(err instanceof ApiError ? err : new ApiError('server', 'x'));
      update({ travellers, booking: null });
    } finally {
      setSending(false);
    }
  };

  const errorCount = Object.keys(errors).length;
  return (
    <CheckoutFrame
      step={3}
      title="Your details"
      subtitle={`${dateLine} · ${slots.length} ${slots.length === 1 ? 'traveller' : 'travellers'} · Step 3 of 4`}
      operatorName={operator.name}
      backHref={back}
      aside={
        <div className="okg-summary">
          <h2 className="okg-h2">{tour.title}</h2>
          <p className="okg-small">{dateLine}</p>
          <p className="okg-muted okg-small">
            {slots.length} {slots.length === 1 ? 'traveller' : 'travellers'}
          </p>
        </div>
      }
    >
      {errorCount > 0 && (
        <Notice
          tone="danger"
          title={`${errorCount} ${errorCount === 1 ? 'thing' : 'things'} to fix before you continue.`}
        >
          {errorCount === 1 ? 'It’s marked below.' : 'They’re marked below.'}
        </Notice>
      )}
      {problem && (
        <Problem
          problem={problem}
          seatsWanted={slots.length}
          date={formatLocalDay(state.departure.localDate)}
          addOns={tour.addOns}
          onChangeDate={() => navigate(`/${opSlug}/${tourSlug}/book`)}
          onChangeTravellers={() => navigate(back)}
          onDropAddOn={(id) => {
            update({ addOns: { ...state.addOns, [id]: 0 } });
            setProblem(null);
          }}
        />
      )}

      <section className="okg-card okg-form-card">
        <div>
          <h2 className="okg-h2">Who’s booking?</h2>
          <p className="okg-muted okg-small">The person paying. We send the ticket here.</p>
        </div>
        <TextField
          label="Full name"
          value={lead.name}
          onChange={(v) => setLead({ name: v })}
          autoComplete="name"
          error={errors['lead.name']}
        />
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          value={lead.email}
          onChange={(v) => setLead({ email: v })}
          autoComplete="email"
          error={errors['lead.email']}
        />
        <TextField
          label="Phone (WhatsApp)"
          type="tel"
          inputMode="tel"
          value={lead.phone}
          onChange={(v) => setLead({ phone: v })}
          autoComplete="tel"
          hint={errors['lead.phone'] ? undefined : 'Give an email or a phone number, or both.'}
          error={errors['lead.phone']}
        />
        <label className="okg-check">
          <input
            type="checkbox"
            checked={lead.marketingConsent}
            onChange={(e) => setLead({ marketingConsent: e.target.checked })}
          />
          <span>Send me offers and news from {operator.name}</span>
        </label>
      </section>

      <section className="okg-card okg-form-card">
        <div>
          <h2 className="okg-h2">Travellers</h2>
          <p className="okg-muted okg-small">
            Names go on the guide’s list. Ages make sure each price is right.
          </p>
        </div>
        <label className="okg-check okg-check--soft">
          <input
            type="checkbox"
            checked={travellingToo}
            onChange={(e) => setTraveller(0, { name: e.target.checked ? lead.name : '' })}
          />
          <span className="okg-strong">I’m travelling too</span>
        </label>
        {slots.map((slot, i) => (
          <fieldset key={i} className="okg-traveller">
            <legend>
              <strong>Traveller {i + 1}</strong>{' '}
              <span className="okg-muted">· {slot.categoryName}</span>
            </legend>
            <div className="okg-traveller__row">
              <TextField
                label="Full name"
                value={travellers[i].name}
                onChange={(v) => setTraveller(i, { name: v })}
                error={errors[`travellers.${i}.name`]}
              />
              <TextField
                label="Age"
                inputMode="numeric"
                value={travellers[i].age}
                onChange={(v) => setTraveller(i, { age: v.replace(/\D/g, '').slice(0, 3) })}
                error={errors[`travellers.${i}.age`]}
              />
            </div>
            <TextField
              label="Dietary needs"
              optional
              value={travellers[i].dietaryNeeds}
              onChange={(v) => setTraveller(i, { dietaryNeeds: v })}
            />
          </fieldset>
        ))}
      </section>

      <section className="okg-card">
        <label className="okg-check">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            aria-describedby={errors['lead.acceptTerms'] ? 'terms-error' : undefined}
          />
          <span>
            I accept the booking terms and the cancellation policy
            {tour.cancellationPolicy ? ' (see the tour page)' : ''}.
          </span>
        </label>
        {errors['lead.acceptTerms'] && (
          <p className="okg-field__error" id="terms-error">
            {errors['lead.acceptTerms']}
          </p>
        )}
      </section>

      <p className="okg-hold-note">We’ll hold your seats for 15 minutes while you pay.</p>
      <button
        type="button"
        className="okg-btn okg-btn--primary"
        onClick={submit}
        disabled={sending}
      >
        {sending ? 'Holding your seats…' : 'Continue to payment'}
      </button>
      <Link className="okg-btn okg-btn--secondary okg-desktop-only" href={back}>
        Back
      </Link>
    </CheckoutFrame>
  );
}

/**
 * What went wrong when holding, as the designs show it. The guest's details are kept.
 * @param {{
 *   problem: ApiError, seatsWanted: number, date: string, addOns: any[],
 *   onChangeDate: () => void, onChangeTravellers: () => void, onDropAddOn: (id: string) => void,
 * }} props
 */
function Problem({
  problem,
  seatsWanted,
  date,
  addOns,
  onChangeDate,
  onChangeTravellers,
  onDropAddOn,
}) {
  if (problem.code === 'SOLD_OUT') {
    const left = Number(problem.details.seatsAvailable ?? 0);
    return (
      <div className="okg-card okg-problem" role="alert">
        <h2 className="okg-h2">
          {left === 0
            ? 'Sorry, this date is now full'
            : `Sorry, only ${left} ${left === 1 ? 'seat is' : 'seats are'} left now`}
        </h2>
        <p className="okg-muted okg-small">
          Someone else booked while you were filling in. You asked for {seatsWanted} seats on {date}
          . Your details are kept.
        </p>
        <button type="button" className="okg-btn okg-btn--primary" onClick={onChangeDate}>
          Choose another date
        </button>
        {left > 0 && (
          <button type="button" className="okg-btn okg-btn--secondary" onClick={onChangeTravellers}>
            Book {left} {left === 1 ? 'traveller' : 'travellers'} instead
          </button>
        )}
      </div>
    );
  }
  if (problem.code === 'ADD_ON_SOLD_OUT') {
    const addOn = addOns.find((a) => a.id === problem.details.addOnId);
    return (
      <div className="okg-card okg-problem" role="alert">
        <h2 className="okg-h2">
          {addOn ? `The ${addOn.name.toLowerCase()} sold out` : 'An extra sold out'}
        </h2>
        <p className="okg-muted okg-small">Continue without it, or pick another date.</p>
        {addOn && (
          <button
            type="button"
            className="okg-btn okg-btn--primary"
            onClick={() => onDropAddOn(addOn.id)}
          >
            Continue without it
          </button>
        )}
        <button type="button" className="okg-btn okg-btn--secondary" onClick={onChangeDate}>
          Choose another date
        </button>
      </div>
    );
  }
  const { title, body } = describeError(problem);
  return (
    <Notice tone="danger" title={title}>
      {body || 'Nothing you entered is lost. Please try again.'}
    </Notice>
  );
}

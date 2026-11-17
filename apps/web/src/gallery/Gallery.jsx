// @ts-check
/**
 * The component gallery (/_gallery): the token sheet rebuilt from the REAL components and
 * tokens, in light and dark. Compare it with docs/designs/00-tokens-lagoon.webp.
 * It's also the redesigner's checklist: restyle the tokens, and everything here follows.
 * Development only; production never links to it.
 */
import { useState } from 'react';
import { LAGOON } from '@okapigo/shared/tokens';
import { formatNaira } from '@okapigo/shared/money';
import { Button } from '../components/Button.jsx';
import { TextField } from '../components/TextField.jsx';
import { Stepper } from '../components/Stepper.jsx';
import { Chip, Notice, TestModeStrip } from '../components/Feedback.jsx';
import { Shell } from '../components/Shell.jsx';
import { ErrorState } from '../components/ErrorState.jsx';
import { ApiError } from '../lib/api.js';

/** @param {{ title: string, children: import('react').ReactNode }} props */
function Section({ title, children }) {
  return (
    <section className="okg-card" style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <h2 style={{ fontSize: 'var(--text-xl)', lineHeight: 'var(--leading-xl)' }}>{title}</h2>
      {children}
    </section>
  );
}

/** @param {{ name: string }} props */
function Swatch({ name }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'var(--color-surface)',
      }}
    >
      <div style={{ height: 56, background: `var(--color-${name})` }} />
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          fontSize: 'var(--text-xs)',
          lineHeight: 'var(--leading-xs)',
        }}
      >
        <strong>color.{name}</strong>
      </div>
    </div>
  );
}

export function Gallery() {
  // Start from what the page is actually showing: the phone's setting, unless forced.
  const [mode, setMode] = useState(
    /** @returns {'light' | 'dark'} */ () =>
      document.documentElement.dataset.mode === 'dark' ||
      (!document.documentElement.dataset.mode &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light',
  );
  const [adults, setAdults] = useState(2);
  const [name, setName] = useState('Adaeze Okafor');
  const [phone, setPhone] = useState('0803 123 45');

  /** @param {'light' | 'dark'} next */
  const switchMode = (next) => {
    setMode(next);
    document.documentElement.dataset.mode = next;
  };

  return (
    <Shell operatorName="Ìrìn Lagos Tours">
      <TestModeStrip />
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', lineHeight: 'var(--leading-2xl)', flex: 1 }}>
          Lagoon tokens
        </h1>
        <Button variant="link" onClick={() => switchMode(mode === 'light' ? 'dark' : 'light')}>
          {mode === 'light' ? 'Show dark' : 'Show light'}
        </Button>
      </div>

      <Section title="Colour">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {Object.keys(LAGOON.color.light).map((k) => (
            <Swatch key={k} name={k} />
          ))}
        </div>
      </Section>

      <Section title="Type">
        {Object.entries(LAGOON.text)
          .reverse()
          .map(([k, [size, line]]) => (
            <p
              key={k}
              style={{
                fontSize: `var(--text-${k})`,
                lineHeight: `var(--leading-${k})`,
                fontWeight: size >= 18 ? 700 : 400,
              }}
            >
              text.{k} {size}/{line}
            </p>
          ))}
        <p className="okg-money">
          Tabular figures: {formatNaira(6_250_000)} · {formatNaira(1_250_000)}
        </p>
      </Section>

      <Section title="Space and shape">
        {Object.entries(LAGOON.space).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ width: 72 }}>space.{k}</span>
            <span
              style={{
                width: v,
                height: 12,
                background: 'var(--color-primary)',
                borderRadius: 'var(--radius-pill)',
              }}
            />
            <span>{v}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {Object.keys(LAGOON.radius)
            .filter((k) => k !== 'pill')
            .map((k) => (
              <span
                key={k}
                className="okg-card"
                style={{
                  borderRadius: `var(--radius-${k})`,
                  borderColor: 'var(--color-border-strong)',
                  padding: 'var(--space-3)',
                }}
              >
                radius.{k} {LAGOON.radius[/** @type {'sm'} */ (k)]}
              </span>
            ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <div className="okg-card okg-card--raised">elevation.1</div>
          <div className="okg-sheet">elevation.2 (sheets, overlay)</div>
        </div>
      </Section>

      <Section title="Buttons">
        <Button>Primary · Pay {formatNaira(6_250_000)}</Button>
        <Button variant="secondary">Secondary · Change date</Button>
        <Button disabled disabledReason="Add an adult to continue">
          Disabled · Continue
        </Button>
        <p>
          <Button variant="link" href="#faqs">
            Text link · See all FAQs
          </Button>
        </p>
      </Section>

      <Section title="Inputs">
        <TextField label="Full name" value={name} onChange={setName} autoComplete="name" />
        <TextField
          label="Phone"
          value={phone}
          onChange={setPhone}
          inputMode="tel"
          error="Enter an 11-digit number like 0803 123 4567, or start with +234."
        />
      </Section>

      <Section title="Stepper, chips, notices">
        <Stepper
          label="Adult (13+)"
          price={formatNaira(2_500_000)}
          value={adults}
          onChange={setAdults}
          max={7}
        />
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Chip tone="warning">Only 3 left</Chip>
          <Chip tone="neutral">Sold out</Chip>
          <Chip tone="primary">12 seats</Chip>
          <Chip tone="success">Paid</Chip>
        </div>
        <Notice tone="warning">warning · “Only 1 seat is left now.”</Notice>
        <Notice tone="danger">danger · “Your payment didn’t go through.”</Notice>
        <TestModeStrip />
      </Section>

      <Section title="Request failed">
        <ErrorState error={new ApiError('offline', "You're offline")} onRetry={() => {}} />
      </Section>
    </Shell>
  );
}

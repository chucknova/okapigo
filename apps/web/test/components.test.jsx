/**
 * The base components: what a guest (or a screen reader) can see and do.
 * Queried by role and label, the way people find things, not by CSS class.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Button } from '../src/components/Button.jsx';
import { TextField } from '../src/components/TextField.jsx';
import { Stepper } from '../src/components/Stepper.jsx';
import { Notice } from '../src/components/Feedback.jsx';
import { firstLetter } from '../src/components/Shell.jsx';

afterEach(cleanup);

describe('Button', () => {
  it('says why it is disabled, in words', () => {
    render(
      <Button disabled disabledReason="Add an adult to continue">
        Continue
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(true);
    expect(screen.getByText('Add an adult to continue')).toBeTruthy();
  });
});

describe('TextField', () => {
  it('has a visible label, and its error is linked to the input', () => {
    render(<TextField label="Phone" value="0803" onChange={() => {}} error="Enter 11 digits." />);
    const input = screen.getByLabelText('Phone');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errorId = input.getAttribute('aria-describedby');
    expect(document.getElementById(errorId).textContent).toBe('Enter 11 digits.');
  });

  it('reports what was typed', () => {
    const onChange = vi.fn();
    render(<TextField label="Full name" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Adaeze' } });
    expect(onChange).toHaveBeenCalledWith('Adaeze');
  });
});

describe('Stepper', () => {
  it('has spoken labels, and stops at its limits', () => {
    const onChange = vi.fn();
    render(<Stepper label="Adult (13+)" value={2} onChange={onChange} min={0} max={2} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove one Adult (13+)' }));
    expect(onChange).toHaveBeenCalledWith(1);
    // At the maximum (e.g. seats left), + is disabled.
    expect(screen.getByRole('button', { name: 'Add one Adult (13+)' }).disabled).toBe(true);
  });
});

describe('Notice', () => {
  it('announces danger at once, warnings politely', () => {
    render(<Notice tone="danger" title="Your payment didn't go through" />);
    render(<Notice tone="warning" title="Only 1 seat is left now" />);
    expect(screen.getByRole('alert').textContent).toContain("didn't go through");
    expect(screen.getByRole('status').textContent).toContain('Only 1 seat');
  });
});

describe('firstLetter (the letter mark)', () => {
  it('keeps tone marks, including two-part Yoruba letters', () => {
    expect(firstLetter('Ìrìn Lagos Tours')).toBe('Ì');
    expect(firstLetter('ọ̀ṣun trails')).toBe('Ọ̀');
    expect(firstLetter('  ')).toBe('?');
  });
});

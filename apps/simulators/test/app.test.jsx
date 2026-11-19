/**
 * The simulator's screens against a fake API (stage 13c-2): sending, tapping, the list sheet,
 * "typing…", a message that didn't send, a person replying, pictures and link previews.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react';
import { App } from '../src/App.jsx';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

/** A pretend API: what's "stored" grows as the guest sends. */
function fakeApi() {
  const stored = [];
  let handledBy = 'bot';
  let n = 0;
  const add = (author, body, extra = {}) =>
    stored.push({ id: String(++n), author, body, createdAt: new Date().toISOString(), ...extra });
  const api = {
    stored,
    add,
    setStaff: (v) => (handledBy = v ? 'staff' : 'bot'),
    operator: vi.fn(async () => ({ name: 'Ìrìn Lagos Tours' })),
    send: vi.fn(async (_slug, body) => {
      add(
        'guest',
        body.text
          ? { kind: 'text', text: body.text }
          : { kind: 'reply', id: body.choice, title: body.title },
      );
      if (body.text === 'Hi') {
        add('bot', {
          kind: 'buttons',
          text: 'Hi! I’m the booking assistant.',
          buttons: [{ id: 'tours', title: 'See tours' }],
        });
      } else if (body.choice === 'tours') {
        add('bot', {
          kind: 'list',
          text: 'Here are our 2 tours.',
          button: 'Choose a tour',
          rows: [
            { id: 'tour:walk', title: 'Heritage Walk', description: 'from ₦25,000' },
            { id: 'tour:food', title: 'Street Food Crawl', description: 'from ₦35,000' },
          ],
        });
      }
      return { conversation: { token: 'tok', handledBy }, replies: [] };
    }),
    messages: vi.fn(async () => ({ conversation: { handledBy }, messages: [...stored] })),
    reset: vi.fn(async () => {
      stored.length = 0;
      return null;
    }),
  };
  return api;
}

async function typeAndSend(text) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('the simulator', () => {
  it('empty at first; "Hi" → the bot’s reply with its button; tapping sends the button', async () => {
    const api = fakeApi();
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    expect(
      await screen.findByText(/Say “Hi” to start chatting with Ìrìn Lagos Tours’/),
    ).toBeTruthy();
    expect(screen.getByText('Booking assistant')).toBeTruthy();

    await typeAndSend('Hi');
    expect(api.send).toHaveBeenCalledWith('irin-lagos-tours', {
      phone: '0803 123 4567',
      name: 'Adaeze Okafor',
      text: 'Hi',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'See tours' }));
    expect(api.send).toHaveBeenLastCalledWith(
      'irin-lagos-tours',
      expect.objectContaining({ choice: 'tours', title: 'See tours' }),
    );
    expect(await screen.findByText('See tours', { selector: 'span' })).toBeTruthy(); // the guest's own bubble
  });

  it('a list opens as a sheet; choosing a row sends it and closes the sheet', async () => {
    const api = fakeApi();
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    await screen.findByText(/Say “Hi”/);
    await typeAndSend('Hi');
    fireEvent.click(await screen.findByRole('button', { name: 'See tours' }));
    fireEvent.click(await screen.findByRole('button', { name: /Choose a tour/ }));
    const sheet = screen.getByRole('dialog', { name: 'Choose a tour' });
    expect(within(sheet).getByText('from ₦35,000')).toBeTruthy();
    fireEvent.click(within(sheet).getByText('Street Food Crawl'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.send).toHaveBeenLastCalledWith(
      'irin-lagos-tours',
      expect.objectContaining({ choice: 'tour:food', title: 'Street Food Crawl' }),
    );
  });

  it('while sending: the message shows at once, and the bot is "typing…"', async () => {
    const api = fakeApi();
    let release;
    api.send.mockImplementationOnce(() => new Promise((r) => (release = r)));
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    await screen.findByText(/Say “Hi”/);
    await typeAndSend('Hello there');
    expect(screen.getByText('Hello there')).toBeTruthy();
    expect(screen.getByText('typing…')).toBeTruthy();
    expect(screen.getByText('Sending…')).toBeTruthy();
    await act(async () =>
      release({ conversation: { token: 'tok', handledBy: 'bot' }, replies: [] }),
    );
    expect(screen.queryByText('typing…')).toBeNull();
  });

  it('a message that didn’t send stays, marked; tapping it tries again', async () => {
    const api = fakeApi();
    api.send.mockRejectedValueOnce(new Error('offline'));
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    await screen.findByText(/Say “Hi”/);
    await typeAndSend('Hi');
    const retry = await screen.findByRole('button', { name: 'Not sent. Tap to try again.' });
    expect(screen.queryByText('typing…')).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'See tours' })).toBeTruthy();
    expect(screen.queryByText('Not sent. Tap to try again.')).toBeNull();
    expect(api.send).toHaveBeenCalledTimes(2);
  });

  it('a person from the team: the header says so, their name on the bubble, events as lines', async () => {
    const api = fakeApi();
    api.add('guest', { kind: 'text', text: 'Hi' });
    api.add('bot', { kind: 'notice', text: 'Tolu from Ìrìn joined · the assistant is paused' });
    api.add('staff', { kind: 'text', text: 'Hi Adaeze, Tolu here.' }, { authorName: 'Tolu' });
    api.setStaff(true);
    localStorage.setItem('okg-sim:chat:irin-lagos-tours:08031234567', JSON.stringify('tok'));
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    expect(await screen.findByText('Ìrìn team is replying')).toBeTruthy();
    expect(screen.getByText('Tolu · Ìrìn team')).toBeTruthy();
    expect(screen.getByText('Tolu from Ìrìn joined · the assistant is paused').tagName).toBe('LI');
  });

  it('while a person answers, the bot doesn’t pretend to type', async () => {
    const api = fakeApi();
    api.setStaff(true);
    api.add('guest', { kind: 'text', text: 'Hi' });
    localStorage.setItem('okg-sim:chat:irin-lagos-tours:08031234567', JSON.stringify('tok'));
    api.send.mockImplementationOnce(() => new Promise(() => {})); // still on its way
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    await screen.findByText('Ìrìn team is replying');
    await typeAndSend('Is there parking?');
    expect(screen.getByText('Sending…')).toBeTruthy();
    expect(screen.queryByText('typing…')).toBeNull();
  });

  it('a picture with its caption; a link’s preview card instead of its bare line', async () => {
    const api = fakeApi();
    const url = 'http://localhost:4000/pay/abc';
    api.add('bot', {
      kind: 'image',
      url: 'http://localhost:4000/t.png',
      caption: 'Your ticket. Show it to the guide at the start.',
    });
    api.add('bot', {
      kind: 'text',
      text: `Here’s your secure payment link.\n${url}\n\nThe link works until 11:15.`,
      link: {
        url,
        title: 'Pay ₦74,000 · Ìrìn Lagos Tours',
        description: 'Street Food Crawl · Sat 5 Dec',
      },
    });
    localStorage.setItem('okg-sim:chat:irin-lagos-tours:08031234567', JSON.stringify('tok'));
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    expect(
      (await screen.findByAltText('Your ticket. Show it to the guide at the start.')).getAttribute(
        'src',
      ),
    ).toBe('http://localhost:4000/t.png');
    const card = screen.getByText('Pay ₦74,000 · Ìrìn Lagos Tours').closest('a');
    expect(card.getAttribute('href')).toBe(url);
    expect(screen.queryAllByText(url, { exact: false })).toHaveLength(0); // shown as "localhost:4000/pay/abc"
    expect(screen.getByText('localhost:4000/pay/abc')).toBeTruthy();
  });

  it('another guest has their own chat; "New chat" empties it', async () => {
    const api = fakeApi();
    api.add('guest', { kind: 'text', text: 'Hi' });
    localStorage.setItem('okg-sim:chat:irin-lagos-tours:08031234567', JSON.stringify('tok'));
    render(<App api={api} operatorSlug="irin-lagos-tours" pollMs={60_000} />);
    expect(await screen.findByText('Hi', { selector: 'span' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText(/Say “Hi”/)).toBeTruthy();
    expect(api.reset).toHaveBeenCalledWith('tok');

    fireEvent.change(screen.getByLabelText('Chatting as'), { target: { value: '0802 555 0101' } });
    await typeAndSend('Hi');
    expect(api.send).toHaveBeenLastCalledWith(
      'irin-lagos-tours',
      expect.objectContaining({ phone: '0802 555 0101', name: 'Tunde Bakare' }),
    );
  });

  it('an unknown business says so', async () => {
    const api = fakeApi();
    api.operator.mockRejectedValueOnce(new Error('404'));
    render(<App api={api} operatorSlug="nobody" pollMs={60_000} />);
    expect(await screen.findByText('No business called “nobody”. Check the address.')).toBeTruthy();
  });
});

/**
 * map-pin.js (16e-4): a meeting point's pin from what an owner pastes. No map service is
 * called, so every shape is read from the text.
 */
import { describe, it, expect } from 'vitest';
import { readMapPin, pinText } from '../src/map-pin.js';

describe('readMapPin', () => {
  it('coordinates on their own, as Google Maps copies them', () => {
    expect(readMapPin('6.4541, 3.3947')).toEqual({ ok: true, lat: 6.4541, lng: 3.3947 });
    expect(readMapPin('  6.4541 3.3947 ')).toEqual({ ok: true, lat: 6.4541, lng: 3.3947 });
    expect(readMapPin('(6.4541,3.3947)')).toEqual({ ok: true, lat: 6.4541, lng: 3.3947 });
    expect(readMapPin('-33.8688, 151.2093')).toEqual({ ok: true, lat: -33.8688, lng: 151.2093 });
    // Tidied to six decimals.
    expect(readMapPin('6.45410123456, 3.39470987654')).toEqual({
      ok: true,
      lat: 6.454101,
      lng: 3.39471,
    });
  });

  it('a Google Maps link: the place itself before the map’s centre', () => {
    expect(
      readMapPin(
        'https://www.google.com/maps/place/Tinubu+Square/@6.4500,3.3900,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d6.4541!4d3.3947',
      ),
    ).toEqual({ ok: true, lat: 6.4541, lng: 3.3947 });
    expect(readMapPin('https://www.google.com/maps/@6.4500,3.3900,15z')).toEqual({
      ok: true,
      lat: 6.45,
      lng: 3.39,
    });
    expect(readMapPin('https://www.google.com/maps?q=6.4541,3.3947')).toEqual({
      ok: true,
      lat: 6.4541,
      lng: 3.3947,
    });
    expect(readMapPin('https://www.google.com/maps/search/?api=1&query=6.4541%2C3.3947')).toEqual({
      ok: true,
      lat: 6.4541,
      lng: 3.3947,
    });
    expect(readMapPin('https://maps.apple.com/?ll=6.4541,3.3947&q=Tinubu')).toEqual({
      ok: true,
      lat: 6.4541,
      lng: 3.3947,
    });
  });

  it('what it can’t read, said', () => {
    expect(readMapPin('')).toEqual({
      ok: false,
      problem: 'Paste a Google Maps link or the coordinates.',
    });
    expect(readMapPin('https://maps.app.goo.gl/AbCdEf123').problem).toMatch(
      /^Short links can’t be read\./,
    );
    expect(readMapPin('https://goo.gl/maps/xyz').problem).toMatch(/^Short links/);
    expect(readMapPin('Tinubu Square, Lagos').problem).toMatch(/^We couldn’t find a place in that/);
    expect(readMapPin('96.1, 3.39')).toEqual({
      ok: false,
      problem: 'Those numbers aren’t a place on the map. Check the coordinates.',
    });
    expect(readMapPin('6.45, 190').ok).toBe(false);
    expect(readMapPin('90, 180').ok).toBe(true);
  });

  it('shown back', () => {
    expect(pinText({ lat: 6.4541, lng: 3.3947 })).toBe('6.4541, 3.3947');
  });
});

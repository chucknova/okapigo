// @ts-check
/**
 * The printable manifest (OPS-07, "Print / PDF"): made by the server (15a), so it needs
 * signal ("PDF · needs signal" offline, designs: O3 states).
 *
 * A plain link can't carry the sign-in token, so the page is fetched with it and opened
 * from memory. The new window is opened FIRST, straight from the tap: a window opened after
 * waiting for the network is blocked as a pop-up.
 * @param {string} departureId @param {string} token
 */
export async function openPrintable(departureId, token) {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(`/api/departures/${departureId}/manifest/print`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
    if (win) win.location.href = url;
    else window.location.href = url;
    return true;
  } catch {
    win?.close();
    return false;
  }
}

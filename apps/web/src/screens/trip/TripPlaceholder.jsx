// @ts-check
/**
 * /trip/:token: the trip hub (QR ticket, map, what to bring) is stage 12f. Until then, the
 * essentials, so "Open your trip page" never leads to a dead end.
 */
import { Link } from 'wouter';
import { formatLocalDay } from '@okapigo/shared/preview';
import { useApi } from '../../lib/data.js';
import { Shell } from '../../components/Shell.jsx';
import { StatusPanel } from '../../components/StatusPanel.jsx';
import { Bar } from '../../components/Skeleton.jsx';

/** @param {{ params: { token: string } }} props */
export function TripPlaceholder({ params }) {
  const b = useApi(`/public/bookings/${params.token}`).data?.booking;
  if (!b) {
    return (
      <Shell operatorName="">
        <Bar height={28} />
      </Shell>
    );
  }
  return (
    <Shell operatorName={b.operator.name}>
      <StatusPanel
        tone="success"
        title={`See you on ${formatLocalDay(b.departure.localDate)}!`}
        context={`${b.tour.title} · ${b.departure.localTime} · ${b.reference}`}
        actions={
          b.balanceKobo > 0 && b.status !== 'held' ? (
            <Link className="okg-btn okg-btn--primary" href={`/trip/${params.token}/pay`}>
              Pay your balance
            </Link>
          ) : null
        }
      >
        Your full trip page, with the QR ticket, map and what to bring, is coming soon.
      </StatusPanel>
    </Shell>
  );
}

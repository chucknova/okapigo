// @ts-check
import { Link } from 'wouter';

/** Sojourna's wordmark, and My bookings. @param {{ children?: import('react').ReactNode }} props */
export function Header({ children }) {
  return (
    <header className="top">
      <div className="top-inner">
        <Link href="/" className="wordmark">
          sojourna<span className="wordmark-dot">.</span>
        </Link>
        {children}
        <Link href="/bookings" className="top-link">
          My bookings
        </Link>
      </div>
    </header>
  );
}

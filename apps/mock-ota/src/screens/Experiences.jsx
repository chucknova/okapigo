// @ts-check
/**
 * M1 · Experiences by one business (designs: "Sojourna — Tours by Ìrìn Lagos Tours"). Its tours
 * come live from the business through OCTO: titles, prices, labels. No photos yet: a coloured
 * band with the kind of experience.
 */
import { Link } from 'wouter';
import { useLoad } from '../lib/use-load.js';
import { cardOf } from '../lib/words.js';
import { nothingListed, offline } from '../lib/states.js';
import { StatePanel } from '../components/StatePanel.jsx';

export function Experiences() {
  const supplier = useLoad('/api/supplier');
  const list = useLoad('/api/experiences');
  const name = supplier.data?.supplier?.name ?? 'This operator';
  const where = supplier.data?.supplier?.contact?.address ?? null;
  const error = supplier.error ?? list.error;
  const cards = (list.data?.experiences ?? []).map(cardOf);

  return (
    <main className="page stack-lg">
      <nav aria-label="Breadcrumb" className="crumbs">
        Nigeria › Lagos › {name}
      </nav>
      <section className="intro">
        <div>
          <h1 className="h1">Experiences by {name}</h1>
          {list.data && (
            <p className="muted">
              {cards.length} {cards.length === 1 ? 'experience' : 'experiences'}
              {where ? ` · local operator in ${where}` : ''} · instant confirmation
            </p>
          )}
        </div>
        <div className="chips">
          <span className="chip">Instant confirmation</span>
          <span className="chip">Mobile ticket</span>
        </div>
      </section>

      {error ? (
        error.problem === 'offline' ? (
          <StatePanel {...offline(name)}>
            <button
              type="button"
              className="btn btn--blue"
              onClick={() => {
                supplier.reload();
                list.reload();
              }}
            >
              Try again
            </button>
          </StatePanel>
        ) : (
          <StatePanel
            tone="bad"
            tag="SOMETHING WENT WRONG"
            title="We couldn’t load these"
            body={error.message}
          />
        )
      ) : list.loading ? (
        <div className="cards" aria-busy="true" aria-label="Loading experiences">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card card--loading" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <StatePanel {...nothingListed(name)} />
      ) : (
        <div className="cards">
          {cards.map((c) => (
            <Link key={c.id} href={`/experiences/${c.id}`} className="card">
              <div aria-hidden="true" className="card-band" style={{ background: c.band }}>
                <span className="card-circle" />
                <span className="card-kind">{c.kind}</span>
              </div>
              <div className="card-body">
                <div className="small muted">
                  by {name}
                  {c.duration ? ` · ${c.duration}` : ''}
                </div>
                <h2 className="card-title">{c.title}</h2>
                <p className="small muted">{c.summary}</p>
                {c.freeCancel && <div className="small ok strong">{c.freeCancel}</div>}
                {c.price && (
                  <div className="card-price">
                    <span className="small muted">from </span>
                    <strong>{c.price}</strong>
                    <span className="small muted"> per adult</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="small muted">
        Tours, prices and seats come live from {name}. Photos coming soon.
      </p>
    </main>
  );
}

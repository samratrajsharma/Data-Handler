import React from 'react';
import './Stack.css';

// ─────────────────────────────────────────────────────────────────
// Stack — a quiet "built on" strip directly after the Hero. Builds
// trust quickly by showing the open-source bones behind Orchestraty
// without forcing a deep-dive yet.
// ─────────────────────────────────────────────────────────────────

const STACK = [
  { name: 'FastAPI', url: 'https://fastapi.tiangolo.com' },
  { name: 'PostgreSQL', url: 'https://www.postgresql.org' },
  { name: 'Celery', url: 'https://docs.celeryq.dev' },
  { name: 'Redis', url: 'https://redis.io' },
  { name: 'MinIO', url: 'https://min.io' },
  { name: 'Qdrant', url: 'https://qdrant.tech' },
  { name: 'React', url: 'https://react.dev' },
  { name: 'Docker', url: 'https://www.docker.com' },
];

const Stack: React.FC = () => {
  return (
    <section className="stack section">
      <div className="container">
        <p className="stack__eyebrow">Built on production-grade open source</p>
        <div className="stack__strip">
          {STACK.map((s) => (
            <a key={s.name} className="stack__item" href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Stack;

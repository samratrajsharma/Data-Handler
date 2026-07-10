import React from 'react';
import './Integrations.css';

// ─────────────────────────────────────────────────────────────────
// Ecosystem strip — surfaces the open stack Orchestraty plugs into.
// Each integration shows a real logo (via simple-icons CDN) when
// available, with a colored letter fallback otherwise. Cards are
// substantial so the section reads as "we work with what you know,"
// not as a sparse chip list.
// ─────────────────────────────────────────────────────────────────

type Integration = {
  name: string;
  role: string;          // one-line role: "Frontier reasoning"
  slug?: string;         // simple-icons slug; omit to render letter fallback
  color: string;         // brand color for the badge/icon backdrop
  url: string;           // official website
};

type Group = {
  label: string;
  icon: React.ReactNode;
  items: Integration[];
};

// Small inline SVG icons for the group headers
const HeaderIcon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const groups: Group[] = [
  {
    label: 'LLM providers',
    icon: <HeaderIcon d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-4 4v1a4 4 0 0 0 2 3.46V18a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-2.54A4 4 0 0 0 20 12v-1a4 4 0 0 0-4-4V6a4 4 0 0 0-4-4z" />,
    items: [
      { name: 'OpenAI',    role: 'GPT-4o · embeddings',     slug: 'openai',    color: '#74AA9C', url: 'https://openai.com' },
      { name: 'Anthropic', role: 'Claude family',           slug: 'anthropic', color: '#D97757', url: 'https://www.anthropic.com' },
      { name: 'Groq',      role: 'Sub-second inference',    slug: 'groq',      color: '#F55036', url: 'https://groq.com' },
      { name: 'Ollama',    role: 'Local · offline LLMs',    slug: 'ollama',    color: '#000000', url: 'https://ollama.com' },
    ],
  },
  {
    label: 'Storage & data',
    icon: <HeaderIcon d="M3 5c0-1.5 4-3 9-3s9 1.5 9 3v14c0 1.5-4 3-9 3s-9-1.5-9-3V5zM3 12c0 1.5 4 3 9 3s9-1.5 9-3" />,
    items: [
      { name: 'PostgreSQL', role: 'Primary database',       slug: 'postgresql', color: '#1DB954', url: 'https://www.postgresql.org' },
      { name: 'MinIO',      role: 'S3-compatible objects',  slug: 'minio',      color: '#C72E29', url: 'https://min.io' },
      { name: 'Redis',      role: 'Cache · task broker',    slug: 'redis',      color: '#DC382D', url: 'https://redis.io' },
    ],
  },
  {
    label: 'Vectors & vision',
    icon: <HeaderIcon d="M21 11.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0z M16 11.5l-4-2-4 2 4 2 4-2z" />,
    items: [
      { name: 'Qdrant',               role: 'Vector search',         color: '#DC382D', url: 'https://qdrant.tech' },
      { name: 'CLIP',                 role: 'Image embeddings',      color: '#1AA34A', url: 'https://github.com/openai/CLIP' },
      { name: 'SentenceTransformers', role: 'Text embeddings',       color: '#1DB954', url: 'https://www.sbert.net' },
    ],
  },
  {
    label: 'Backend & orchestration',
    icon: <HeaderIcon d="M4 6h16M4 12h16M4 18h16" />,
    items: [
      { name: 'FastAPI', role: 'Async API server',  slug: 'fastapi', color: '#009688', url: 'https://fastapi.tiangolo.com' },
      { name: 'Celery',  role: 'Background tasks',  slug: 'celery',  color: '#37814A', url: 'https://docs.celeryq.dev' },
      { name: 'Docker',  role: 'Container runtime', slug: 'docker',  color: '#1DB954', url: 'https://www.docker.com' },
    ],
  },
];

// Logo url helper. simple-icons CDN serves clean monochrome SVGs that we
// render in the brand color via a `fill` style on the parent.
const logoUrl = (slug: string) => `https://cdn.simpleicons.org/${slug}`;

const Integrations: React.FC = () => {
  return (
    <section className="integrations section" id="integrations" aria-labelledby="integrations-title">
      <div className="container">
        <div className="integrations__header">
          <span className="integrations__eyebrow">Open stack</span>
          <h2 id="integrations-title" className="integrations__title">
            Built on the tools you already trust
          </h2>
          <p className="integrations__subtitle">
            Plug into any LLM provider. Run on your own infrastructure. Store data where it belongs. No proprietary lock-in.
          </p>
        </div>

        <div className="integrations__groups">
          {groups.map((g) => (
            <div className="int-group" key={g.label}>
              <div className="int-group__head">
                <span className="int-group__icon" aria-hidden="true">{g.icon}</span>
                <span className="int-group__label">{g.label}</span>
              </div>
              <ul className="int-group__list">
                {g.items.map((item) => (
                  <li key={item.name}>
                  <a className="int-card" href={item.url} target="_blank" rel="noopener noreferrer" style={{ ['--int-color' as string]: item.color }}>
                    <span className="int-card__logo">
                      {item.slug ? (
                        <img
                          src={logoUrl(item.slug)}
                          alt=""
                          width="28"
                          height="28"
                          loading="lazy"
                          onError={(e) => {
                            // If the CDN can't serve a logo, fall back to the letter chip.
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                            const parent = (e.currentTarget as HTMLImageElement).parentElement;
                            if (parent) {
                              parent.classList.add('int-card__logo--fallback');
                              parent.textContent = item.name.charAt(0);
                            }
                          }}
                        />
                      ) : (
                        <span className="int-card__logo--fallback-text">{item.name.charAt(0)}</span>
                      )}
                    </span>
                    <span className="int-card__body">
                      <span className="int-card__name">{item.name}</span>
                      <span className="int-card__role">{item.role}</span>
                    </span>
                  </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="integrations__footnote">
          And anything else with an OpenAI-compatible endpoint, an S3 API, or a Python SDK.
        </p>
      </div>
    </section>
  );
};

export default Integrations;

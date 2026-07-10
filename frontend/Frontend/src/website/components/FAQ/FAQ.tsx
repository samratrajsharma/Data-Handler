import React, { useState } from 'react';
import './FAQ.css';

interface QA { q: string; a: React.ReactNode; }

const FAQ_ITEMS: QA[] = [
  {
    q: 'How do I install Orchestraty?',
    a: (
      <>
        One command: <code>pip install orchestraty</code>. It pulls down the API,
        the Celery worker, and the dashboard. Run <code>orchestraty up</code> and the
        whole stack boots on your machine — Postgres, Redis, MinIO, Qdrant, and all.
      </>
    ),
  },
  {
    q: 'Where does my data actually go?',
    a: (
      <>
        On your computer. Datasets land in a local MinIO bucket, metadata in a local
        Postgres, vectors in a local Qdrant. Nothing leaves the box unless you
        explicitly call an LLM API. No telemetry, no analytics, no usage reporting.
      </>
    ),
  },
  {
    q: 'Which LLM providers does it support?',
    a: (
      <>
        OpenAI, Anthropic, Groq, Ollama, and anything OpenAI-compatible (LM Studio,
        vLLM, LiteLLM proxies). You bring the API key, you pick the model per task,
        you see exactly which model decided each label.
      </>
    ),
  },
  {
    q: 'Do I need Docker?',
    a: (
      <>
        Right now, yes — Postgres / Redis / MinIO / Qdrant come up via Docker Compose.
        A pure-Python embedded mode is on the roadmap for smaller experiments.
      </>
    ),
  },
  {
    q: 'Is it really free?',
    a: (
      <>
        Yes, MIT licensed. There is no paid tier. If Orchestraty saves you time
        and you want to support development, donation channels are coming soon —
        in the meantime, file issues, contribute, or tell other people about it.
      </>
    ),
  },
  {
    q: 'Can I run it on a remote server, not just my laptop?',
    a: (
      <>
        Yes. The Docker Compose stack works on any machine that runs Docker —
        a workstation, a homelab box, an EC2 instance. There is no notion of
        users or accounts; whoever can reach the port has access. That is by
        design for the single-user model.
      </>
    ),
  },
  {
    q: 'Why no accounts?',
    a: (
      <>
        Orchestraty is a tool, not a service. A login screen would imply a
        backend storing your credentials, which would imply a cloud, which would
        imply we touch your data. We don't want any of that. Single user,
        local-first, full stop.
      </>
    ),
  },
  {
    q: 'How is it different from MLflow, Label Studio, or Weights & Biases?',
    a: (
      <>
        Those are great tools, each focused on one slice. Orchestraty is opinionated
        end-to-end: ingest → structure → EDA → label → review → ship. Same data
        model from CSV upload to exported dataset. Local-first. Bring-your-own-LLM.
        Free.
      </>
    ),
  },
];

const FAQ: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="faq section" id="faq">
      <div className="container">
        <div className="faq__header">
          <span className="faq__eyebrow">FAQ</span>
          <h2 className="faq__title">Honest answers to honest questions</h2>
        </div>
        <div className="faq__list">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className={`faq__item${isOpen ? ' faq__item--open' : ''}`}>
                <button
                  type="button"
                  className="faq__q"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  <span>{item.q}</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isOpen && <div className="faq__a">{item.a}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FAQ;

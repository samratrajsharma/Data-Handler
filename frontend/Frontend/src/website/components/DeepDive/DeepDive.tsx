import React from 'react';
import './DeepDive.css';

// ─────────────────────────────────────────────────────────────────
// DeepDive — "What you can actually do with Orchestraty".
// Three long-form blocks, each with: badge, title, paragraph, and a
// small visual aid (mock data table / pipeline / embedding cloud)
// to give the reader something concrete to anchor on.
// ─────────────────────────────────────────────────────────────────

const DeepDive: React.FC = () => {
  return (
    <section className="deepdive section" id="deep-dive">
      <div className="container">
        <div className="deepdive__header">
          <span className="deepdive__eyebrow">What you can do</span>
          <h2 className="deepdive__title">A closer look at the three engines</h2>
          <p className="deepdive__subtitle">
            Orchestraty is built around three concrete jobs. Each one is fully implemented,
            each one lives entirely on your machine, each one uses the same data model.
          </p>
        </div>

        {/* ── Block 1: Structuring ─────────────────────────────── */}
        <div className="deepdive__block" id="data-pipelines">
          <div className="deepdive__block-text">
            <span className="deepdive__chip">01 · Structuring</span>
            <h3 className="deepdive__block-title">
              Every dataset becomes versioned, profiled, and reproducible.
            </h3>
            <p className="deepdive__block-desc">
              Point Orchestraty at any table and it profiles it, scores its quality, and
              writes an immutable, versioned copy with full lineage. The plumbing —
              formats, encodings, types, nulls — is handled silently; what you keep is a
              dataset you can trust and reproduce. Re-run it tomorrow on a fresh export
              and you get the same shape, the same hash, the same checks.
            </p>
            <ul className="deepdive__bullets">
              <li>Immutable, versioned datasets with full lineage</li>
              <li>Automated quality scoring + statistical profiling (EDA)</li>
              <li>Embeddings + density clustering to reveal hidden structure</li>
              <li>Formats, encodings, types and nulls handled silently</li>
            </ul>
          </div>
          <div className="deepdive__block-visual">
            <div className="deepdive__mock">
              <div className="deepdive__mock-bar">
                <span className="deepdive__mock-title">customers_q4.csv → v3 (raw → structured)</span>
              </div>
              <div className="deepdive__mock-body">
                <div className="deepdive__mock-row deepdive__mock-row--head">
                  <span>email</span><span>name</span><span>age</span><span>quality</span>
                </div>
                <div className="deepdive__mock-row">
                  <span className="deepdive__mock-good">amy@…</span><span>Amy Liu</span><span>34</span>
                  <span className="deepdive__mock-pill deepdive__mock-pill--g">98%</span>
                </div>
                <div className="deepdive__mock-row">
                  <span className="deepdive__mock-good">ben@…</span><span>Ben Park</span><span>—</span>
                  <span className="deepdive__mock-pill deepdive__mock-pill--y">71%</span>
                </div>
                <div className="deepdive__mock-row">
                  <span className="deepdive__mock-good">car@…</span><span>Carla Reyes</span><span>52</span>
                  <span className="deepdive__mock-pill deepdive__mock-pill--g">95%</span>
                </div>
                <div className="deepdive__mock-row">
                  <span className="deepdive__mock-good">dev@…</span><span>Devon Sim</span><span>27</span>
                  <span className="deepdive__mock-pill deepdive__mock-pill--g">99%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Block 2: Labeling ────────────────────────────────── */}
        <div className="deepdive__block deepdive__block--reverse" id="ai-labeling">
          <div className="deepdive__block-text">
            <span className="deepdive__chip deepdive__chip--alt">02 · Labeling</span>
            <h3 className="deepdive__block-title">
              Label thousands of rows with rules, LLMs, and propagation — together.
            </h3>
            <p className="deepdive__block-desc">
              Rule-based labels for the patterns you already know. LLM predictions for the
              fuzzy ones. Similarity propagation to spread known labels through embedding
              space. Confidence-weighted aggregation reconciles all three sources, then a
              review step lets you sample-check and ship. You stay in control of every
              cut-off.
            </p>
            <ul className="deepdive__bullets">
              <li>Compound rule editor (AND / OR, ranges, between, in-set)</li>
              <li>LLM labels with custom instructions per provider</li>
              <li>Embedding-based propagation + synthetic generation</li>
              <li>Per-row provenance — see exactly which source decided each label</li>
            </ul>
          </div>
          <div className="deepdive__block-visual">
            <div className="deepdive__layers">
              <div className="deepdive__layer deepdive__layer--rule">
                <span className="deepdive__layer-tag">RULE</span>
                <span className="deepdive__layer-text">amount &gt; 10k → high_value</span>
              </div>
              <div className="deepdive__layer deepdive__layer--llm">
                <span className="deepdive__layer-tag">LLM</span>
                <span className="deepdive__layer-text">"flag complaints &amp; angry tone"</span>
              </div>
              <div className="deepdive__layer deepdive__layer--prop">
                <span className="deepdive__layer-tag">PROP</span>
                <span className="deepdive__layer-text">spread 200 labels to 12k siblings</span>
              </div>
              <div className="deepdive__layer-arrow" aria-hidden="true">↓</div>
              <div className="deepdive__layer deepdive__layer--out">
                <span className="deepdive__layer-tag">OUT</span>
                <span className="deepdive__layer-text">14,238 rows · 96% labeled</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Block 3: Vision ─────────────────────────────────── */}
        <div className="deepdive__block" id="image-intelligence">
          <div className="deepdive__block-text">
            <span className="deepdive__chip deepdive__chip--alt2">03 · Vision</span>
            <h3 className="deepdive__block-title">
              Turn a folder of images into a searchable visual library.
            </h3>
            <p className="deepdive__block-desc">
              Upload images individually or by folder. Orchestraty extracts EXIF, generates
              CLIP embeddings, clusters visually similar groups, and indexes everything in
              Qdrant. Then you can ask "show me product shots on a white background" and
              get a ranked list back. No labels required.
            </p>
            <ul className="deepdive__bullets">
              <li>EXIF + metadata + thumbnail pipeline</li>
              <li>CLIP embeddings (text + image, same space)</li>
              <li>HDBSCAN clustering for "find similar"</li>
              <li>Text-to-image semantic search via Qdrant</li>
            </ul>
          </div>
          <div className="deepdive__block-visual">
            <div className="deepdive__embed">
              <div className="deepdive__embed-query">
                <span>🔍</span> "outdoor product on grass"
              </div>
              <div className="deepdive__embed-grid">
                {[0.96, 0.94, 0.91, 0.89, 0.86, 0.83].map((s, i) => (
                  <div key={i} className="deepdive__embed-tile">
                    <div className="deepdive__embed-thumb" />
                    <div className="deepdive__embed-score">{s.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DeepDive;

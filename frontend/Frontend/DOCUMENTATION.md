# Orchestrate — Frontend Documentation

> A complete guide to the Orchestrate company website frontend: stack, structure, components, and design system.

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Framework** | React 18 | Component-based UI, fast rendering |
| **Language** | TypeScript | Type safety, better autocomplete |
| **Build Tool** | Vite 8 | Extremely fast dev server & HMR |
| **Styling** | Vanilla CSS (CSS Modules pattern) | Full control, no framework lock-in |
| **Package Manager** | npm | Standard, works out of the box |
| **Font** | Inter (Google Fonts) | Clean, modern, widely used in SaaS |
| **Icons** | Inline SVGs | No external icon library needed |
| **Animations** | CSS keyframes + Canvas API | Lightweight, no animation library |

> No UI libraries (no Tailwind, no MUI, no Chakra). Everything is hand-written CSS for maximum control.

---

## 📁 Project Structure

```
Frontend/
│
├── index.html                  ← HTML entry point (title, meta, favicon, font import)
├── package.json                ← Dependencies and scripts
├── vite.config.ts              ← Vite configuration
├── tsconfig.json               ← TypeScript config
├── DOCUMENTATION.md            ← This file
│
└── src/
    ├── main.tsx                ← React root mount (renders <App /> into #root)
    ├── App.tsx                 ← Main layout — assembles all sections
    ├── App.css                 ← App-level layout styles
    ├── index.css               ← Global reset, CSS variables, typography
    │
    └── components/
        ├── Logo/
        │   └── AntigravityLogo.tsx     ← Orchestrate SVG icon (node-network logo)
        │
        ├── Navbar/
        │   ├── Navbar.tsx              ← Top navigation bar
        │   └── Navbar.css
        │
        ├── ParticleCanvas/
        │   ├── ParticleCanvas.tsx      ← Animated background particles
        │   └── ParticleCanvas.css
        │
        ├── Hero/
        │   ├── Hero.tsx                ← Full-screen landing section
        │   └── Hero.css
        │
        ├── Features/
        │   ├── Features.tsx            ← 6-card feature grid
        │   └── Features.css
        │
        ├── UseCases/
        │   ├── UseCases.tsx            ← 4 numbered use case cards
        │   └── UseCases.css
        │
        ├── Pricing/
        │   ├── Pricing.tsx             ← 3-tier pricing with toggle
        │   └── Pricing.css
        │
        └── Footer/
            ├── Footer.tsx              ← Dark footer with links
            └── Footer.css
```

---

## 🎨 Design System

Defined in `src/index.css` as CSS custom properties (variables):

```css
--color-primary:       #6366f1   /* Indigo — main brand color */
--color-primary-dark:  #4f46e5   /* Darker indigo for hover states */
--color-primary-light: #eef2ff   /* Light indigo for backgrounds */
--color-accent:        #06b6d4   /* Cyan — secondary accent */
--color-success:       #10b981   /* Emerald green */
--color-warning:       #f59e0b   /* Amber */
--color-danger:        #ef4444   /* Red */
--color-text:          #0f0f10   /* Near black */
--color-text-secondary:#6b7280   /* Muted gray */
--color-border:        #e5e7eb   /* Light border */
--nav-height:          64px      /* Fixed navbar height */
```

### Typography
- Font: **Inter** (loaded from Google Fonts)
- Weights used: 300, 400, 500, 600, 700, 800
- Headlines use `letter-spacing: -0.03em` and `font-weight: 800` for a modern SaaS look
- Body text: `font-size: 15–16px`, `line-height: 1.6–1.7`

---

## 🧩 Components Explained

### 1. `Logo/AntigravityLogo.tsx`
A pure SVG React component. Draws the Orchestrate icon — three outer nodes connected to a central node, representing agent orchestration. Accepts a `size` prop (default `24`).

---

### 2. `Navbar/Navbar.tsx`
**What it does:**
- Fixed to top, blurs background on scroll (`backdrop-filter: blur`)
- Left: Logo + brand name
- Center: Nav links — Product, Use Cases, Pricing, Blog, Resources
- Right: Sign In link + **Get Started** CTA button
- Dropdowns on hover for items with sub-pages
- Mobile: Hamburger menu toggles a full-width dropdown

**State used:**

| State | Type | Purpose |
|---|---|---|
| `activeDropdown` | `string \| null` | Tracks which nav item's dropdown is open |
| `scrolled` | `boolean` | Adds border + shadow when page scrolls |
| `mobileOpen` | `boolean` | Toggles mobile menu |

---

### 3. `ParticleCanvas/ParticleCanvas.tsx`
**What it does:** Renders an animated `<canvas>` element behind the Hero section. Dots float slowly around the screen, fading in and out.

**How it works:**
- Uses the browser **Canvas 2D API** (no external library)
- Particles are created with random positions, velocities, sizes, and Orchestrate brand colors
- `requestAnimationFrame` loop moves them every frame
- Wraps around screen edges
- Resizes with the window

**Colors used (Orchestrate palette):**
`#6366f1`, `#8b5cf6`, `#a855f7`, `#06b6d4`, `#10b981`, `#f59e0b`

---

### 4. `Hero/Hero.tsx`
**The main landing section.** Full viewport height (`min-height: 100vh`).

**Contains:**
- 🟢 **Beta badge** — animated pulsing dot + text
- 🔷 **Brand mark** — logo icon + "Orchestrate" name
- 📝 **Headline** — "Build, deploy and manage AI agents at scale"
- 📄 **Subtext** — one-liner about what Orchestrate does
- 🎯 **2 CTA buttons:**
  - `Start for free` → primary indigo button
  - `See how it works` → outlined secondary button
- 👥 **Social proof** — avatar stack + "Trusted by 10,000+ developers"

---

### 5. `Features/Features.tsx`
A **3-column grid** of 6 feature cards. Each card has:
- Colored icon (inline SVG in a colored rounded square)
- Small category tag (e.g. "Orchestration", "Security")
- Card title
- Description text

**The 6 features:**
1. Multi-Agent Pipelines
2. Sandboxed Execution
3. Verifiable Artifacts
4. Connect Any Stack
5. Any LLM, Your Choice
6. Team & Access Control

Cards have a subtle lift effect on hover (`transform: translateY(-4px)`).

---

### 6. `UseCases/UseCases.tsx`
**4 horizontal cards**, each with a number tag (01–04).

| # | Use Case | Color |
|---|---|---|
| 01 | Full-Stack Software Development | Indigo |
| 02 | Research & Deep Analysis | Emerald |
| 03 | Enterprise Automation | Violet |
| 04 | Content & Documentation | Cyan |

Each card shows: number, title, description, tag pills, and a decorative visual panel on the right.

---

### 7. `Pricing/Pricing.tsx`
**3-tier pricing grid** with a monthly/annual toggle.

| Plan | Price | Target |
|---|---|---|
| Starter | $00 | Individuals |
| Pro ⭐ | $00/mo | Professional devs |
| Enterprise | $00/mo | Large teams |

> NOTE: Prices are set to $00 as placeholders.
> Update the `price` field in each plan object in `src/components/Pricing/Pricing.tsx` when pricing is finalized.

**State used:**
- `annual` (boolean) — toggles between monthly and annual display

The popular "Pro" card has a highlighted border and a "Most Popular" badge.

---

### 8. `Footer/Footer.tsx`
Dark (`#0f0f10`) full-width footer with:
- **Left:** Orchestrate logo + tagline + social icon links
- **Right:** 4 link columns — Product, Use Cases, Resources, Company
- **Bottom bar:** Copyright line + Privacy / Terms / Cookies links

---

## 🔄 How Everything Connects

```
main.tsx
  └── App.tsx
        ├── <Navbar />          ← always visible, fixed top
        ├── <Hero />            ← includes <ParticleCanvas />
        ├── <Features />
        ├── <UseCases />
        ├── <Pricing />
        └── <Footer />
```

The page is a **single-page layout** — all sections live on one scroll.
Nav links use anchor IDs (`#pricing`, `#use-cases`, etc.) to jump to sections.

---

## ⚙️ Available Scripts

```bash
npm run dev      # Start local dev server → http://localhost:5173
npm run build    # Build for production (outputs to /dist)
npm run preview  # Preview the production build locally
```

---

## 🚀 To Run Locally

```bash
# 1. Go to the project folder
cd "c:\Users\OMEN\OneDrive\Desktop\Frontend"

# 2. Install dependencies (first time only)
npm install

# 3. Start the dev server
npm run dev

# 4. Open in browser
# → http://localhost:5173
```

---

## 📋 Quick Reference — Where to Change Things

| What you want to change | File to edit |
|---|---|
| Brand name / logo | `src/components/Logo/AntigravityLogo.tsx` |
| Nav links & dropdowns | `src/components/Navbar/Navbar.tsx` |
| Hero headline & CTAs | `src/components/Hero/Hero.tsx` |
| Particle dot colors | `src/components/ParticleCanvas/ParticleCanvas.tsx` |
| Feature cards | `src/components/Features/Features.tsx` |
| Use case descriptions | `src/components/UseCases/UseCases.tsx` |
| Pricing plans & prices | `src/components/Pricing/Pricing.tsx` |
| Footer links & copyright | `src/components/Footer/Footer.tsx` |
| Brand colors (global) | `src/index.css` (CSS variables) |
| Page title & SEO | `index.html` |

# Data Handler Frontend Setup

## Quick Start

```bash
# 1. Navigate to the React app
cd frontend/Frontend

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
# Opens at http://localhost:5173
```

## Architecture

```
frontend/
├── Frontend/           # React app (Vite + TypeScript)
│   ├── src/
│   │   ├── api/        # 13 API service modules (axios)
│   │   ├── context/    # AuthContext (JWT, login, register)
│   │   ├── hooks/      # usePolling (task status polling)
│   │   ├── layouts/    # DashboardLayout (white sidebar + content)
│   │   ├── pages/      # 15 page components
│   │   │   ├── auth/           Login, Register
│   │   │   ├── dashboard/      Overview stats
│   │   │   ├── datasets/       List, Detail
│   │   │   ├── structuring/    Data cleaning pipeline
│   │   │   ├── eda/            Profiling, embeddings, clustering
│   │   │   ├── labeling/       Rule-based labeling
│   │   │   ├── ai-labeling/    AI predictions, synthetic, propagation
│   │   │   ├── images/         Upload, gallery, CLIP search
│   │   │   ├── review/         Quality eval, review actions, export
│   │   │   ├── workflows/      Pipeline orchestration
│   │   │   ├── llm/            LLM provider configuration
│   │   │   ├── admin/          User management (admin only)
│   │   │   ├── tasks/          Background task monitor
│   │   │   └── audit/          System audit logs
│   │   ├── components/         # Landing page components (existing)
│   │   └── stencil-components/ # Web component bridge
│   └── package.json
│
└── stencil-ui/         # Stencil web component library
    ├── src/components/
    │   ├── orc-button/         Primary/secondary/danger buttons
    │   ├── orc-badge/          Status badges with variants
    │   ├── orc-stat-card/      Dashboard metric cards
    │   ├── orc-modal/          Dialog overlays
    │   ├── orc-progress-bar/   Task progress indicators
    │   ├── orc-spinner/        Loading spinners
    │   ├── orc-toast/          Notification toasts
    │   └── orc-data-table/     Sortable data tables
    ├── stencil.config.ts
    └── package.json
```

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | Landing | Marketing page |
| `/app/login` | Login | Email + password auth |
| `/app/register` | Register | Create account |
| `/app` | Dashboard | System overview |
| `/app/datasets` | Datasets | List & upload datasets |
| `/app/datasets/:id` | Dataset Detail | Single dataset view |
| `/app/structuring` | Structuring | Clean & normalize data |
| `/app/eda` | EDA | Profile, embed, cluster |
| `/app/labeling` | Labeling | Rule-based labeling |
| `/app/ai-labeling` | AI Labeling | LLM-powered labeling |
| `/app/images` | Images | Image pipeline + CLIP |
| `/app/review` | Review | Quality, review, export |
| `/app/workflows` | Workflows | Pipeline orchestration |
| `/app/workflows/:id` | Workflow Detail | Step-by-step progress |
| `/app/llm` | LLM Config | Provider management |
| `/app/admin` | Admin | User management |
| `/app/tasks` | Tasks | Background task monitor |
| `/app/audit` | Audit Logs | Activity tracking |

## Stencil Components (Production Build)

```bash
cd frontend/stencil-ui
npm install
npm run build
```

The built components can then be imported as custom elements.
During development, the `stencil-components/index.ts` bridge provides
vanilla Custom Element implementations that work without a build step.

## API Proxy

The Vite dev server proxies `/api` to `http://localhost:8000` (FastAPI backend).
Make sure your backend is running before starting the frontend.

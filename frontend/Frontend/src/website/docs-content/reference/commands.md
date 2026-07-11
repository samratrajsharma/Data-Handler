# Commands

Run these from `ai-operating-system/`.

## Day-to-day

```powershell
.\setup.ps1            # backend (:8000) + dashboard at http://localhost:5173
.\setup.ps1 -Website   # backend + marketing site at http://localhost:5273
.\setup.ps1 -Fresh     # wipe ALL Docker volumes and start clean
.\stop.ps1             # stop the dev server + docker compose down (volumes kept)
```

## Under the hood

```bash
# Bring services up manually
docker compose -f infrastructure/docker-compose.yml up -d

# Rebuild images
docker compose -f infrastructure/docker-compose.yml up -d --build --force-recreate

# Run migrations
docker exec orchestraty-api alembic upgrade head
docker exec orchestraty-api alembic current
```

## Frontend

```bash
cd frontend/Frontend
npm install
npm run dev            # dashboard (:5173)
npm run dev:website    # marketing site (:5273)
npm run build          # type-check + production build
npx tsc -b             # type-check only
```

## Health checks

```bash
curl http://localhost:8000/health
```

.PHONY: init init-check init-backend init-frontend smoke smoke-backend smoke-frontend smoke-api \
        lint-quick lint-quick-backend lint-quick-frontend preflight \
        ci-local ci-local-backend ci-local-frontend \
        dev dev-backend dev-frontend \
        init-mobile dev-mobile dev-mobile-android dev-mobile-ios dev-mobile-web \
        expo-types-mobile typecheck-mobile lint-mobile ci-local-mobile \
        db-migrate db-rollback db-status \
        redis-ping redis-cli \
        build-docker run-docker run-docker-dev stop-docker logs \
        test-backend test-anchor \
        load-test load-test-smoke load-test-staging \
        anchor-build anchor-deploy-devnet \
        audit-checklist \
        help

BACKEND_REQUIREMENTS ?= backend/requirements.docker.txt
VENV := .venv/bin

# ─── Help ─────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "XiaoLee — Comandos Disponíveis"
	@echo "═══════════════════════════════════════"
	@echo "  make init              → Setup inicial completo"
	@echo "  make dev               → Sobe backend + frontend em modo dev"
	@echo "  make dev-backend LLM=groq → Backend com o chat no modelo free (anthropic = Claude)"
	@echo "  make test-backend      → Suite de testes Python (65 testes)"
	@echo "  make db-migrate        → Aplica migrações Alembic"
	@echo "  make run-docker        → Sobe stack completa (PostgreSQL + Redis + Grafana)"
	@echo "  make load-test-smoke   → Testa de carga rápido (20 users, 2min)"
	@echo "  make anchor-build      → Compila o programa Solana"
	@echo "  make audit-checklist   → Exibe checklist de mainnet readiness"
	@echo ""

# ─── Init ─────────────────────────────────────────────────────────────────────
init:
	@echo "Initializing XiaoLee project..."
	@$(MAKE) init-check
	@[ -f .env ] || cp .env.example .env
	@echo "📋 .env criado — preencha as variáveis antes de continuar"
	@$(MAKE) init-backend
	@$(MAKE) init-frontend
	@echo "✅ Done. Próximos passos: 'make dev' ou 'make run-docker'"

init-check:
	@echo "Checking local toolchain..."
	@command -v python3 >/dev/null 2>&1 || (echo "❌ python3 is required" && exit 1)
	@command -v node >/dev/null 2>&1 || (echo "❌ node is required" && exit 1)
	@command -v npm >/dev/null 2>&1 || (echo "❌ npm is required" && exit 1)
	@command -v docker >/dev/null 2>&1 || (echo "❌ docker is required" && exit 1)
	@python3 --version && node --version && npm --version && docker --version
	@docker compose version

init-backend:
	@echo "Installing backend dependencies..."
	@[ -d .venv ] || python3 -m venv .venv
	@$(VENV)/pip install --quiet -r backend/requirements.txt

init-frontend:
	@echo "Installing frontend dependencies..."
	@[ -f frontend/package-lock.json ] && cd frontend && npm ci || cd frontend && npm install

# ─── Desenvolvimento ──────────────────────────────────────────────────────────
dev:
	@echo "Starting dev environment..."
	@$(MAKE) dev-backend &
	@$(MAKE) dev-frontend

# LLM=groq|anthropic|gemini troca o cérebro do chat só nesta execução, sem editar
# o .env (variável de ambiente ganha do .env). Ex.: make dev-backend LLM=groq
dev-backend:
	@cd backend && $(if $(LLM),LLM_PROVIDER=$(LLM) ,)../.venv/bin/uvicorn server.app:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	@cd frontend && npm run dev

# ─── Mobile (Expo / React Native) ─────────────────────────────────────────────
# O app deriva a URL do backend do host do Metro (mobile/src/lib/config.ts), entao
# `make dev-backend` precisa estar rodando em 0.0.0.0:8000 e o aparelho na mesma rede.
init-mobile:
	@[ -f mobile/.env ] || cp mobile/.env.example mobile/.env
	@cd mobile && npm install

dev-mobile:
	@cd mobile && npm start

dev-mobile-android:
	@cd mobile && npm run android

dev-mobile-ios:
	@cd mobile && npm run ios

dev-mobile-web:
	@cd mobile && npm run web

# `expo-env.d.ts` e `.expo/types/router.d.ts` são gerados e ficam no .gitignore —
# num clone novo o tsc quebra sem eles. `expo customize tsconfig.json` regenera os
# dois sem tocar no tsconfig.json versionado.
expo-types-mobile:
	@cd mobile && npx expo customize tsconfig.json

typecheck-mobile: expo-types-mobile
	@cd mobile && npx tsc --noEmit

lint-mobile:
	@cd mobile && npm run lint

# Mesma sequência do .github/workflows/mobile-ci.yml
ci-local-mobile: expo-types-mobile
	@cd mobile && npm run lint && npx tsc --noEmit && npx expo export --platform all --output-dir dist

# ─── Testes ───────────────────────────────────────────────────────────────────
smoke:
	@$(MAKE) smoke-backend
	@$(MAKE) smoke-frontend
	@echo "✅ Smoke checks OK"

smoke-api:
	@cd backend && ../.venv/bin/python scripts/smoke_api.py

smoke-backend:
	@cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 ../.venv/bin/pytest -q tests/test_metrics.py

smoke-frontend:
	@cd frontend && npm test -- src/utils/swap.test.ts --passWithNoTests

test-backend:
	@echo "Running backend test suite..."
	@cd backend && ../.venv/bin/pytest tests/ -q --no-header -p no:anchorpy
	@echo "✅ Backend tests OK"

lint-quick:
	@$(MAKE) lint-quick-backend
	@$(MAKE) lint-quick-frontend

lint-quick-backend:
	@cd backend && ../.venv/bin/python -m py_compile server/app.py server/metrics.py server/rate_limiter.py

lint-quick-frontend:
	@cd frontend && npm run lint -- --file src/components/navbar/Wallet.tsx

preflight:
	@$(MAKE) init-check
	@$(MAKE) smoke
	@$(MAKE) lint-quick
	@echo "✅ Preflight OK"

ci-local:
	@$(MAKE) ci-local-backend
	@$(MAKE) ci-local-frontend

ci-local-backend:
	@cd backend && ../.venv/bin/pytest tests/ -q --no-header -p no:anchorpy

ci-local-frontend:
	@cd frontend && npm run lint && npm run build

# ─── Banco de Dados (Alembic) ─────────────────────────────────────────────────
db-migrate:
	@echo "Aplicando migrações Alembic..."
	@cd backend && ../.venv/bin/alembic upgrade head
	@echo "✅ Migrações aplicadas"

db-rollback:
	@echo "Revertendo última migração..."
	@cd backend && ../.venv/bin/alembic downgrade -1
	@echo "✅ Rollback OK"

db-status:
	@cd backend && ../.venv/bin/alembic current && ../.venv/bin/alembic history

db-new-migration:
	@[ -n "$(MSG)" ] || (echo "Uso: make db-new-migration MSG='descricao'" && exit 1)
	@cd backend && ../.venv/bin/alembic revision --autogenerate -m "$(MSG)"

# ─── Redis ────────────────────────────────────────────────────────────────────
redis-ping:
	@docker compose exec redis redis-cli -a "$${REDIS_PASSWORD:-xiaolee_redis_dev}" ping

redis-cli:
	@docker compose exec redis redis-cli -a "$${REDIS_PASSWORD:-xiaolee_redis_dev}"

redis-rate-stats:
	@docker compose exec redis redis-cli -a "$${REDIS_PASSWORD:-xiaolee_redis_dev}" keys "xiaolee:rl:*" | head -20

# ─── Docker ───────────────────────────────────────────────────────────────────
build-docker:
	@echo "Building Docker images..."
	@docker compose build

run-docker:
	@echo "Starting full stack (PostgreSQL + Redis + Grafana)..."
	@docker compose up -d postgres redis
	@echo "Waiting for DB and Redis to be healthy..."
	@sleep 5
	@docker compose up -d alembic-migrate
	@docker compose up -d xiaolee-core xiaolee-frontend prometheus grafana
	@echo "✅ Stack UP"
	@echo "   Backend:    http://localhost:8000"
	@echo "   Frontend:   http://localhost:3000"
	@echo "   Grafana:    http://localhost:3001  (admin/\$$GRAFANA_ADMIN_PASSWORD)"
	@echo "   Prometheus: http://localhost:9090"

run-docker-dev:
	@docker compose up -d postgres redis
	@docker compose up xiaolee-core

stop-docker:
	@docker compose down

stop-docker-clean:
	@docker compose down -v --remove-orphans

logs:
	@docker compose logs -f xiaolee-core

# ─── Testes de Carga (Locust) ─────────────────────────────────────────────────
load-test-smoke:
	@echo "🔥 Smoke load test (20 users, 2min)..."
	@$(VENV)/locust -f load_tests/locustfile.py \
		--host=http://localhost:8000 \
		--users=20 --spawn-rate=4 --run-time=120s --headless

load-test-staging:
	@[ -n "$(HOST)" ] || (echo "Uso: make load-test-staging HOST=https://api-staging.xiaolee.io" && exit 1)
	@echo "🔥 Staging load test (100 users, 10min)..."
	@mkdir -p load_tests/reports
	@$(VENV)/locust -f load_tests/locustfile.py \
		--host=$(HOST) \
		--users=100 --spawn-rate=10 --run-time=600s --headless \
		--html=load_tests/reports/staging_$$(date +%Y%m%d_%H%M%S).html

load-test-ui:
	@echo "Abrindo Locust UI em http://localhost:8089..."
	@$(VENV)/locust -f load_tests/locustfile.py --host=http://localhost:8000

# ─── Solana / Anchor ──────────────────────────────────────────────────────────
anchor-build:
	@echo "Compilando programa Anchor..."
	@cd solana-program/xiaolee_core && anchor build
	@echo "✅ Build OK — IDL atualizado em target/idl/"
	@echo "💡 Copie o IDL: cp target/idl/xiaolee_core.json ../../frontend/src/idl/"

anchor-test:
	@cd solana-program/xiaolee_core && anchor test

anchor-deploy-devnet:
	@echo "Deploy para devnet..."
	@cd solana-program/xiaolee_core && anchor deploy --provider.cluster devnet
	@echo "✅ Deploy OK. Verifique em: https://explorer.solana.com/?cluster=devnet"

anchor-idl-sync:
	@echo "Sincronizando IDL com frontend..."
	@cp solana-program/xiaolee_core/target/idl/xiaolee_core.json frontend/src/idl/xiaolee_core.json
	@echo "✅ IDL sincronizado"

# ─── Auditoria / Mainnet ──────────────────────────────────────────────────────
audit-checklist:
	@echo ""
	@echo "🔐 XiaoLee — Mainnet Readiness Checklist"
	@echo "═══════════════════════════════════════════"
	@echo ""
	@echo "🔴 BLOQUEADORES P0 (obrigatório antes do mainnet):"
	@echo "  [ ] Auditoria externa — mínimo 2 firmas (Trail of Bits, Ottersec, Sec3)"
	@echo "  [ ] PostgreSQL de produção provisionado + alembic upgrade head"
	@echo "  [ ] Redis de produção configurado (REDIS_URL)"
	@echo "  [ ] SOLANA_ADMIN_KEYPAIR_B58 no vault + record_swap testado em devnet"
	@echo "  [ ] HTTPS + HSTS no servidor de produção"
	@echo "  [ ] Secrets via vault (não .env em texto simples)"
	@echo ""
	@echo "🟡 OBRIGATÓRIO P1 (antes do mainnet saudável):"
	@echo "  [ ] Locust em staging: make load-test-staging HOST=https://staging.xiaolee.io"
	@echo "  [ ] Multisig Gnosis Safe como admin do protocolo"
	@echo "  [ ] Tenderly Alerts configurado"
	@echo "  [ ] initialize_global executado na mainnet"
	@echo ""
	@echo "📖 Consulte: docs/MAINNET_READINESS.md para detalhes completos"
	@echo ""


BACKEND_REQUIREMENTS ?= backend/requirements.docker.txt

init:
	@echo "Initializing XiaoLee project..."
	@$(MAKE) init-check
	@[ -f .env ] || cp .env.example .env
	@$(MAKE) init-backend
	@$(MAKE) init-frontend
	@echo "Done. Next steps: run 'make smoke', 'make dev' or 'make run-docker'."

init-check:
	@echo "Checking local toolchain..."
	@command -v python3 >/dev/null 2>&1 || (echo "python3 is required" && exit 1)
	@command -v node >/dev/null 2>&1 || (echo "node is required" && exit 1)
	@command -v npm >/dev/null 2>&1 || (echo "npm is required" && exit 1)
	@command -v docker >/dev/null 2>&1 || (echo "docker is required" && exit 1)
	@python3 --version
	@node --version
	@npm --version
	@docker --version
	@docker compose version

smoke:
	@echo "Running quick smoke checks..."
	@$(MAKE) smoke-backend
	@$(MAKE) smoke-frontend
	@echo "Smoke checks finished successfully."

smoke-api:
	@echo "Running API smoke checks via local HTTP..."
	@cd backend && ../.venv/bin/python scripts/smoke_api.py

smoke-backend:
	@echo "Backend smoke tests..."
	@cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 ../.venv/bin/pytest -q tests/test_metrics.py

smoke-frontend:
	@echo "Frontend smoke tests..."
	@cd frontend && npm test -- src/utils/swap.test.ts

lint-quick:
	@echo "Running quick lint checks..."
	@$(MAKE) lint-quick-backend
	@$(MAKE) lint-quick-frontend
	@echo "Quick lint checks finished successfully."

lint-quick-backend:
	@echo "Backend quick lint..."
	@cd backend && ../.venv/bin/python -m py_compile server/app.py server/metrics.py

lint-quick-frontend:
	@echo "Frontend quick lint..."
	@cd frontend && npm run lint -- --file src/components/navbar/Wallet.tsx

preflight:
	@echo "Running preflight checks..."
	@$(MAKE) init-check
	@$(MAKE) smoke
	@$(MAKE) smoke-api
	@$(MAKE) lint-quick
	@echo "Preflight checks finished successfully."

ci-local:
	@echo "Running local CI pipeline..."
	@$(MAKE) init-check
	@$(MAKE) ci-local-backend
	@$(MAKE) ci-local-frontend
	@echo "Local CI pipeline finished successfully."

ci-local-backend:
	@echo "CI local backend: install + pytest..."
	@if [ -x .venv/bin/python ]; then \
		.venv/bin/python -m pip install -r $(BACKEND_REQUIREMENTS); \
		PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/pytest -q -p pytest_asyncio -c backend/pytest.ini backend/tests; \
	else \
		python3 -m pip install -r $(BACKEND_REQUIREMENTS); \
		PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest -q -p pytest_asyncio -c backend/pytest.ini backend/tests; \
	fi

ci-local-frontend:
	@echo "CI local frontend: npm ci + lint + test + build..."
	@cd frontend && npm ci && npm run lint && npm test && npm run build

init-backend:
	@echo "Installing backend dependencies..."
	@if [ -x .venv/bin/python ]; then \
		.venv/bin/python -m pip install -r $(BACKEND_REQUIREMENTS); \
	else \
		python3 -m pip install -r $(BACKEND_REQUIREMENTS); \
	fi

init-frontend:
	@echo "Installing frontend dependencies..."
	@if [ -f frontend/package-lock.json ]; then \
		cd frontend && npm ci; \
	else \
		cd frontend && npm install; \
	fi

dev:
	@echo "Starting local dev environment (Backend & Frontend)..."
	@bash -c "cd backend && uvicorn server.app:app --reload & cd frontend && npm run dev"

build-docker:
	docker compose build

run-docker:
	docker compose up -d

stop-docker:
	docker compose down

test-backend:
	cd backend && pytest tests/

test-anchor:
	cd solana-program/xiaolee_core && anchor test

e2e-tests:
	@echo "Running E2E tests against local environment..."
	python qa/scripts/e2e_flow_simulation.py

stress-test:
	@echo "Starting Locust for stress testing..."
	locust -f qa/load_testing/locustfile.py --host=http://localhost:8000

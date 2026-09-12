# DeskcommCRM — Workflow de Construção

Ordem definida pelo Rafael: **PRD → Regras de Negócio → Specs → Epics → Stories → Plano com Tasks**.

---

## Fase 0 — Brainstorming (em andamento)

- [x] Entender demanda e confirmar com o usuário
- [x] Decidir tenancy model (multi-tenant clássico desde dia 1)
- [x] Decidir escopo MVP (Opção B — com IA core)
- [x] Decidir integração e-commerce (Nuvemshop only)
- [x] Decidir perfil do primeiro tenant (PME médio)
- [x] Ler material de referência da Aula CRM Nichado WAHA
- [x] Decidir adoção da arquitetura de referência (integral, opção A)
- [x] Criar skeleton de docs do projeto
- [x] Preservar síntese da referência em `docs/research/`

## Fase 1 — PRD-Mestre + sub-PRDs

- [x] Escrever PRD-Mestre (`docs/prd/00-prd-master.md`) — visão, problema, escopo, stakeholders, métricas, restrições — **v0.1 escrito, em revisão pelo Rafael**
- [x] Sub-PRD 01: Plataforma Base (auth, multi-tenant, RBAC, audit, LGPD framework) — **v0.1 escrito**
- [x] Sub-PRD 02: Customer 360° + Identity Resolution determinística — **v0.1 escrito**
- [x] Sub-PRD 03: Canal WhatsApp (WAHA + anti-banimento + janela 24h + multi-atendente) — **v0.1 escrito**
- [x] Sub-PRD 04: Pipeline Kanban + Atendimento + Tickets + Handoff — **v0.1 escrito**
- [x] Sub-PRD 05: IA Conversacional (chatbot + RAG por tenant + sentiment detection) — **v0.1 escrito**
- [x] Sub-PRD 06: Integração Nuvemshop + LGPD webhooks — **v0.1 escrito**
- [x] Revisão final do PRD-Mestre + sub-PRDs — **spot-check de consistência cross-doc passou**

## Fase 2 — Regras de Negócio

- [x] Regras de tenancy e isolamento (T-01 a T-08) — em `docs/business-rules/00-business-rules-catalog.md`
- [x] Regras LGPD (L-01 a L-10) — idem
- [x] Regras WhatsApp (W-01 a W-12) — idem
- [x] Regras de pipeline (P-01 a P-08) — idem
- [x] Regras de atendimento (AT-01 a AT-08) — idem
- [x] Regras de IA (IA-01 a IA-11) — idem
- [x] Regras de billing/uso (B-01 a B-05) — idem

## Fase 3 — Specs Técnicas — **COMPLETA (8 specs, ~60k palavras)**

- [x] Spec 01 Plataforma Base (auth, RLS templates, audit, LGPD framework, API conventions)
- [x] Spec 02 Customer 360 + Identity Resolution
- [x] Spec 03 WhatsApp via WAHA Plus
- [x] Spec 04 Pipeline Kanban + Atendimento (UI 3 colunas)
- [x] Spec 05 IA + RAG + Sentiment + Handoff
- [x] Spec 06 Nuvemshop + LGPD
- [x] Spec 07 Event Log + Workers + Crons (transversal)
- [x] Spec 08 Deploy + Observability (transversal)
- [x] 15 diagramas Mermaid em `docs/research/architecture-diagrams.md`

## Fase 3.5 — Design System + Screen Flow (extra) — **COMPLETA**

- [x] Showcase navegável `/design` com 5 paletas + 4 tipografias + 3 densidades + componentes + motion
- [x] Direção locked: **Sage + Atkinson Hyperlegible + Aerada + Phosphor**
- [x] Tokens materializados em `tailwind.config.ts` + `app/globals.css` + `app/layout.tsx`
- [x] `<ThemeProvider>` com light/dark/system + persistência localStorage
- [x] shadcn components reescritos pra Sage (button/card/input/textarea/badge)
- [x] Documentação em `docs/design-system/` (11 arquivos, ~10.4k palavras)
- [x] Screen flow em `docs/design-system/screen-flow/` (9 arquivos, ~13.8k palavras)
- [x] 94 telas inventariadas + 5 jornadas + 8 clickflows + 9 state machines

## Fase 4 — Epics

> **Status real (2026-09-12)**: a numeração E1–E7 abaixo é a original do brainstorming.
> Os epics canônicos vivem em `docs/stories/epics/EPIC-*.md` e estão mais avançados
> do que esta lista sugere. O mapeamento e o status verificado no código são:

- [x] EPIC-00 Foundation & Tooling — **completo** (8 waves)
- [x] EPIC-01 Auth & App Shell — **completo** (12 waves)
- [x] EPIC-02 Tenant Onboarding — **completo** (8 waves; WhatsApp QR build-only, E2E precisa Docker)
- [x] EPIC-03 Inbox + Messaging — **completo** (15 waves; E2E send/receive precisa WAHA ativo)
- [x] EPIC-04 Pipeline Kanban — **completo** (10 waves)
- [x] EPIC-05 Customer 360 + Contacts — **completo** (9 waves)
- [x] EPIC-06 AI Agent + RAG + Sentiment + Handoff — **completo** (12/12 waves implementadas)
- [x] EPIC-07 Nuvemshop Integration — **completo** (11 waves)
- [x] EPIC-08 LGPD Compliance — **completo** (8/8 waves: receivers, workers, pages, SLA watcher)
- [x] EPIC-09 Team & Permissions — **completo** (7 waves; Resend real + service-role listing pendem env)
- [x] EPIC-10 Audit & Settings — **completo** (9 waves; notification_prefs stubbed; sessions/storage/email change deferred)
- [x] EPIC-11 Super-Admin Platform — **quase completo** (13/14 waves; S-11.14 billing overview pendente, S-11.10 cross-tenant search parcial)
- [x] EPIC-12 Hardening + E2E + Polish — **completo** (10 waves; Lighthouse CI + bundle-analyzer + /app/* E2E deferred)
- [x] EPIC-13 AI Agents Module — **completo** (12/12 waves: MCP tools, dispatcher, credentials, agents UI)

### Gap restante identificado


## Fase 5 — Stories

- [x] Stories detalhadas com ACs para EPIC-00 a EPIC-13 (`docs/stories/epics/`)
- [ ] Estimativas relativas (T-shirt sizing) — parcialmente feito nos epics (points por wave)
- [ ] Priorizar por Now/Next/Later — feito informalmente; falta documento consolidado

## Fase 6 — Plano de Tasks

- [x] Tasks técnicas quebradas dentro de cada story/wave dos epics
- [ ] Sequenciar dependências entre epics em documento único (hoje só nos headers de cada epic)
- [ ] Cronograma e marcos consolidados

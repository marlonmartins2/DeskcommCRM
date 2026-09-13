# Academia Information and Opening Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar cadastro tenant-aware de endereço, contatos, regras e funcionamento semanal, com edição pela tela e consulta direta obrigatória pela IA.

**Architecture:** `academia_profiles` será a raiz do agregado por organização e `academia_opening_hours` guardará no máximo um período local recorrente por dia. Uma RPC autenticada, com autorização interna e controle de revisão, substituirá perfil, fuso e semana atomicamente. Uma tool MCP read-only lerá a fonte operacional e um gate determinístico impedirá a IA de adiar ou inventar a resposta.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6 estrito, Zod 4, Supabase/Postgres 15 com RLS, Vitest 4 e Playwright 1.

## Global Constraints

- O banco relacional é a fonte oficial; o RAG não será implementado nesta entrega e nunca prevalecerá sobre a consulta estruturada.
- Endereço e regras são texto livre; telefone, WhatsApp e e-mail são campos separados.
- Cada dia ISO 1–7 aceita zero ou um período; zero significa fechado.
- O fuso vem de `organizations.timezone`; não haverá cópia em `academia_profiles`.
- A migration não semeia endereço, contatos, regras ou funcionamento presumidos.
- Perguntas explícitas sobre feriados, recessos e exceções fazem handoff; o restante é respondido como semana regular.
- A rota de usuário não usa `createAdminClient()`. A RPC usa o client autenticado e repete papel, módulo, suporte e MFA no banco.
- Toda leitura service-role da tool MCP filtra `organization_id` obtido de `McpContext`, nunca do input.
- A API usa `snake_case`, Zod, `ok()`/`fail()` e auditoria sem valores de contato.
- Schema exige migration 0237, apêndice idempotente no baseline, MANIFEST, tipos regenerados e `pnpm test:db`.
- `lib/database.types.ts` é gerado e nunca será editado manualmente.
- A UI exige prova Playwright visual e responsiva; os PNGs de evidência não serão commitados.

## File map

- Create `lib/academia/information.ts`: contrato Zod, tipos e projeção dos sete dias.
- Create `tests/unit/academia-information.test.ts`: valida horários, contatos, fuso e unicidade diária.
- Create `supabase/migrations/20260911130000_0237_academia_informacoes_funcionamento.sql`: tabelas, RLS, trigger e RPC.
- Modify `supabase/baseline.sql` and `supabase/migrations/MANIFEST.md`: distribuição self-host.
- Create `tests/invariants/academia-information.test.ts`: RLS, RPC, revisão e invariantes reais.
- Regenerate `lib/database.types.ts`: contrato gerado do schema aplicado.
- Create `app/api/v1/academia/information/route.ts` and `tests/unit/academia-information-api.test.ts`: GET/PUT.
- Create `app/app/academia/_information.tsx`: formulário e funcionamento semanal.
- Modify `app/app/academia/_workspace.tsx`, `app/app/academia/page.tsx`, `lib/i18n/dicionario.ts`: integração visual.
- Create `tests/e2e/academia-informacoes-local.spec.ts` and modify `.github/workflows/e2e.yml`: prova opt-in declarada.
- Create `lib/mcp/tools/academia-information.ts` and `tests/unit/mcp-academia-information.test.ts`: consulta da IA.
- Modify `lib/mcp/tools/index.ts`, `lib/mcp/tools/catalogo/academia.ts`, `lib/ai/agents/capacidades-padrao.ts`: publicação da capacidade.
- Create `lib/academia/consulta-informacoes.ts`: sinal inequívoco e projeção temporal.
- Create `lib/agent-engine/agent/academia-information-prompt.ts`: instrução residente.
- Modify `lib/agent-engine/guardrails/before-send.ts`, `lib/agent-engine/agent/inbound-turn.ts`, `lib/agent-engine/agent/preview.ts`: anti-evasão.
- Modify `docs/architecture/academia.md`: estado entregue e estratégia futura de RAG.

---

### Task 1: Contrato puro da informação operacional

**Files:**
- Create: `tests/unit/academia-information.test.ts`
- Create: `lib/academia/information.ts`

**Interfaces:**
- Produces: `academiaInformationWriteSchema`, `AcademiaInformationWrite`, `OpeningPeriod`, `projectOpeningWeek()`.
- Consumes: `fusoValido()` e `weekdays`.

- [ ] **Step 1: escrever o teste vermelho**

```ts
const base = {
  revision: 0,
  profile: {
    address: "Rua A, 10",
    phone: "1133334444",
    whatsapp: "11999998888",
    email: "contato@example.com",
    public_rules: "Leve toalha.",
  },
  timezone: "America/Sao_Paulo",
  opening_hours: [
    { weekday: 1, opens_at: "05:00", closes_at: "23:00" },
  ],
};

it("projeta os sete dias com um período contínuo por dia aberto", () => {
  const parsed = academiaInformationWriteSchema.parse(base);
  expect(projectOpeningWeek(parsed.opening_hours)[0]).toEqual({
    weekday: 1,
    label: "Segunda-feira",
    closed: false,
    periods: [{ opens_at: "05:00", closes_at: "23:00" }],
  });
  expect(projectOpeningWeek(parsed.opening_hours)[1]?.closed).toBe(true);
});

it("recusa dois períodos no mesmo dia", () => {
  expect(academiaInformationWriteSchema.safeParse({
    ...base,
    opening_hours: [
      { weekday: 1, opens_at: "05:00", closes_at: "12:00" },
      { weekday: 1, opens_at: "14:00", closes_at: "23:00" },
    ],
  }).success).toBe(false);
});
```

Acrescentar casos literais para `opens_at >= closes_at`, dia 0/8, `24:00`, fuso IANA inválido, e-mail inválido e campos acima dos limites 500/32/320/5000.

- [ ] **Step 2: confirmar RED**

Run: `pnpm vitest run tests/unit/academia-information.test.ts`

Expected: FAIL porque `@/lib/academia/information` ainda não existe.

- [ ] **Step 3: implementar o mínimo**

Criar schemas estritos, normalizar string vazia para `null`, validar fuso com `fusoValido`, rejeitar dia duplicado e ordenar por dia. `projectOpeningWeek()` sempre devolve os sete dias.

- [ ] **Step 4: confirmar GREEN**

Run: `pnpm vitest run tests/unit/academia-information.test.ts`

Expected: PASS. Remover a checagem de dia duplicado deve quebrar o caso correspondente.

- [ ] **Step 5: commit**

```bash
git add lib/academia/information.ts tests/unit/academia-information.test.ts
git commit -m "feat(academia): define contrato de funcionamento"
```

---

### Task 2: Schema, RLS e gravação atômica

**Files:**
- Create: `tests/invariants/academia-information.test.ts`
- Create: `supabase/migrations/20260911130000_0237_academia_informacoes_funcionamento.sql`
- Modify: `supabase/baseline.sql`
- Modify: `supabase/migrations/MANIFEST.md`
- Modify `tests/invariants/rls-completude-varredura.test.ts`: declarar a cobertura das duas tabelas novas; se o hook congelar o arquivo, mover a mesma prova comportamental para o novo invariante sem desativar o hook.
- Regenerate: `lib/database.types.ts`

**Interfaces:**
- Produces: `academia_profiles`, `academia_opening_hours`, `fn_salvar_academia_info(uuid,integer,text,text,text,text,text,text,jsonb) returns integer`.
- Consumes: helpers existentes de papel, suporte, MFA e flag do módulo.

- [ ] **Step 1: escrever o invariante vermelho**

O teste Postgres cria duas organizações e prova:

```ts
const saved = await as(manager,
  "select fn_salvar_academia_info($1,0,$2,$3,$4,$5,$6,$7,$8::jsonb) revision",
  [org, "Rua A, 10", "1133334444", "11999998888", "contato@example.com",
   "Leve toalha.", "America/Sao_Paulo", JSON.stringify([
     { weekday: 1, opens_at: "05:00", closes_at: "23:00" },
   ])]);
expect(saved.rows[0].revision).toBe(1);
expect((await as(viewer,
  "select address from academia_profiles where organization_id=$1", [org])).rowCount).toBe(1);
expect((await as(outsider,
  "select address from academia_profiles where organization_id=$1", [org])).rowCount).toBe(0);
await expect(as(viewer,
  "select fn_salvar_academia_info($1,1,null,null,null,null,null,'UTC','[]')", [org]))
  .rejects.toMatchObject({ code: "42501" });
await expect(as(manager,
  "select fn_salvar_academia_info($1,0,null,null,null,null,null,'UTC','[]')", [org]))
  .rejects.toMatchObject({ code: "40001" });
```

Adicionar tentativa de segundo período no mesmo dia, rollback integral, módulo desligado, tenant alheio, anon sem SELECT/EXECUTE e impossibilidade de DML direto por authenticated.

- [ ] **Step 2: confirmar RED**

Run: `pnpm test:db`

Expected: FAIL no novo teste por relação ou função inexistente.

- [ ] **Step 3: implementar migration e baseline**

`academia_profiles` tem PK/FK `organization_id`, cinco campos nullable com limites, `revision > 0`, timestamps. `academia_opening_hours` tem UUID, tenant, dia 1–7, `opens_at`, `closes_at`, precisão de minuto, `opens_at < closes_at`, timestamps e UNIQUE `(organization_id,weekday)`.

As policies SELECT exigem membership e módulo ativo. `authenticated` não recebe DML direto; `service_role` recebe ALL. A constraint única torna impossível persistir dois horários regulares para o mesmo dia.

A RPC `security definer`:

1. trava `organizations` por id;
2. exige `auth.uid()`, manager, suporte com escrita, MFA e módulo ativo;
3. valida fuso em `pg_timezone_names` e array JSON;
4. trata ausência de perfil como revisão 0;
5. lança `40001` se a revisão observada divergir;
6. grava perfil, atualiza somente `organizations.timezone` e substitui períodos na mesma transação;
7. retorna a nova revisão.

Revogar EXECUTE de `public,anon,authenticated` em toda função criada; conceder a RPC somente a `authenticated`. Registrar sua assinatura e call site em `AUTHENTICATED_PERMITIDO` se o invariante de hardening exigir. O baseline repete o SQL em apêndice idempotente e o MANIFEST registra a 0237. Não criar dados iniciais.

- [ ] **Step 4: confirmar GREEN do banco**

Run: `pnpm test:db`

Expected: baseline install OK, update OK e todos os invariantes PASS.

- [ ] **Step 5: regenerar tipos**

Run:

```bash
npx supabase gen types typescript --local > /tmp/deskcomm-academia-database.types.ts
cp /tmp/deskcomm-academia-database.types.ts lib/database.types.ts
pnpm typecheck
```

Expected: as duas tabelas e a RPC aparecem; typecheck passa. Se o banco local tiver schema alheio, gerar contra instância descartável construída somente do baseline desta branch. Não recortar nem editar manualmente.

- [ ] **Step 6: commit**

```bash
git add supabase/migrations/20260911130000_0237_academia_informacoes_funcionamento.sql supabase/baseline.sql supabase/migrations/MANIFEST.md tests/invariants/academia-information.test.ts tests/invariants/rls-completude-varredura.test.ts tests/invariants/hardening-definer-varredura.test.ts lib/database.types.ts
git commit -m "feat(academia): persiste informações e funcionamento"
```

---

### Task 3: API autenticada do agregado

**Files:**
- Create: `tests/unit/academia-information-api.test.ts`
- Create: `app/api/v1/academia/information/route.ts`
- Modify: `lib/audit/actions.ts`

**Interfaces:**
- Produces: GET/PUT `/api/v1/academia/information`.
- Consumes: schema da Task 1 e RPC da Task 2.

- [ ] **Step 1: escrever testes vermelhos**

Cobrir GET sem perfil com revisão 0 e sete dias, GET filtrado pelo tenant, PUT sem tenant no body, manager autorizado, viewer/suporte readonly negado, erro `40001` → 409, `23514|22023` → 422 e auditoria sem valores.

```ts
expect(rpc).toHaveBeenCalledWith("fn_salvar_academia_info", {
  p_org: org,
  p_expected_revision: 0,
  p_address: "Rua A, 10",
  p_phone: "1133334444",
  p_whatsapp: "11999998888",
  p_email: "contato@example.com",
  p_public_rules: "Leve toalha.",
  p_timezone: "America/Sao_Paulo",
  p_periods: [{ weekday: 1, opens_at: "05:00", closes_at: "12:00" }],
});
expect(audit).toHaveBeenCalledWith(expect.objectContaining({
  action: "academia_info.updated",
  organizationId: org,
  metadata: { fields_changed: ["address", "phone", "whatsapp", "email", "public_rules", "timezone", "opening_hours"], opening_periods: 1 },
}));
```

- [ ] **Step 2: confirmar RED**

Run: `pnpm vitest run tests/unit/academia-information-api.test.ts`

Expected: FAIL porque a rota e a ação ainda não existem.

- [ ] **Step 3: implementar GET/PUT**

GET usa `requireAcademia`, consulta organização/perfil/períodos em paralelo, filtra ids explicitamente, normaliza TIME para HH:mm, projeta sete dias e retorna `no-store`. PUT chama `requireSupportWrite` antes de `requireAcademia(...,"manager")`, valida body estrito, usa client autenticado para a RPC, mapeia erros e audita apenas nomes de campos e quantidade.

- [ ] **Step 4: confirmar GREEN**

Run: `pnpm vitest run tests/unit/academia-information-api.test.ts tests/unit/academia-schedule-api.test.ts`

Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add app/api/v1/academia/information/route.ts tests/unit/academia-information-api.test.ts lib/audit/actions.ts
git commit -m "feat(academia): expõe informações operacionais"
```

---

### Task 4: Aba Informações

**Files:**
- Create: `tests/e2e/academia-informacoes-local.spec.ts`
- Modify: `.github/workflows/e2e.yml`
- Create: `app/app/academia/_information.tsx`
- Modify: `app/app/academia/_workspace.tsx`
- Modify: `app/app/academia/page.tsx`
- Modify: `lib/i18n/dicionario.ts`

**Interfaces:**
- Produces: aba Informações editável e responsiva.
- Consumes: API da Task 3 e `FUSOS_OFERECIDOS`.

- [ ] **Step 1: escrever a spec E2E antes da UI**

A spec autentica no ambiente dedicado, abre Informações, preenche endereço/contatos/regras, configura segunda `05:00–23:00`, mantém domingo fechado, salva, recarrega e confirma persistência. Também provoca PUT concorrente para ver mensagem de conflito e testa viewport 390×844 sem overflow. Screenshots vão para `.superpowers/evidence/`.

- [ ] **Step 2: declarar cobertura e confirmar RED visual**

Adicionar `academia-informacoes-local.spec.ts` ao bloco `FORA_DO_CI`, sob a justificativa já existente das credenciais locais. Executar `pnpm vitest run tests/unit/e2e-cobertura-completa.test.ts` (PASS) e depois a spec contra o servidor de QA (FAIL por aba ausente).

- [ ] **Step 3: implementar a UI mínima**

`_information.tsx` é client component síncrono. Carrega GET com AbortController, conserva dados em falha, usa snapshot serializado para “Alterações não salvas”, valida com o schema e envia PUT. Abrir um dia cria abertura/fechamento vazios, nunca um horário presumido. Fechar um dia zera o período somente no estado local. `canEdit=false` deixa campos desabilitados e oculta ações.

`_workspace.tsx` ganha o union `"schedule" | "catalogs" | "information"`, botão e renderização condicional. `page.tsx` passa a mencionar informações da unidade. Toda string que passa por `t()`/`traduzir()` recebe tradução em espanhol.

- [ ] **Step 4: confirmar GREEN estático**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run tests/unit/e2e-cobertura-completa.test.ts`

Expected: exit 0 e lint com 0 erros.

- [ ] **Step 5: commit**

```bash
git add app/app/academia/_information.tsx app/app/academia/_workspace.tsx app/app/academia/page.tsx lib/i18n/dicionario.ts tests/e2e/academia-informacoes-local.spec.ts .github/workflows/e2e.yml
git commit -m "feat(academia): adiciona tela de informações"
```

---

### Task 5: Tool MCP de informações

**Files:**
- Create: `tests/unit/mcp-academia-information.test.ts`
- Create: `lib/mcp/tools/academia-information.ts`
- Modify: `lib/mcp/tools/index.ts`
- Modify: `lib/mcp/tools/catalogo/academia.ts`
- Modify: `lib/ai/agents/capacidades-padrao.ts`
- Modify: `tests/unit/capacidades-padrao-do-onboarding.test.ts`

**Interfaces:**
- Produces: `crmGetAcademiaInfo`, tool `crm_get_academia_info` read-only.
- Consumes: tabelas da Task 2 e projeções da Task 1.

- [ ] **Step 1: escrever testes vermelhos**

Cobrir endereço sem tenant alheio, contatos separados/ausentes, segunda com um período, dia fechado, `today|now` no fuso com relógio controlado, módulo desligado e falha de banco estável.

```ts
const result = await crmGetAcademiaInfo.handler(
  { subject: "opening_hours", weekday: 1 }, context(baseTables()));
expect(result).toMatchObject({
  source: "cadastro_operacional",
  schedule_kind: "semanal_regular",
  timezone: "America/Sao_Paulo",
  opening_hours: {
    weekday: 1,
    day: "Segunda-feira",
    closed: false,
    periods: [{ opens_at: "05:00", closes_at: "23:00" }],
  },
});
expect(JSON.stringify(result)).not.toContain("org-2");
```

- [ ] **Step 2: confirmar RED**

Run: `pnpm vitest run tests/unit/mcp-academia-information.test.ts tests/unit/capacidades-padrao-do-onboarding.test.ts`

Expected: FAIL pela tool inexistente.

- [ ] **Step 3: implementar e registrar**

Input:

```ts
const inputShape = {
  subject: z.enum(["address", "contact", "opening_hours", "rules"]),
  weekday: z.number().int().min(1).max(7).optional(),
  temporal_reference: z.enum(["today", "now"]).optional(),
};
```

O handler lê `organizations.settings,timezone` por `id=ctx.organizationId`, falha fechado no módulo e consulta somente as tabelas necessárias sempre com `organization_id`. A saída não expõe UUIDs; inclui `source`, `schedule_kind`, `missing_fields`, `updated_at`, fuso e aviso de exceções. `now` calcula dia/hora local e `within_regular_hours`.

Registrar handler/catálogo e filtrar as duas tools Academia por módulo em `catalogoComHandler`. A nova tool entra no pacote `vender` porque é leitura segura da informação pública solicitada.

- [ ] **Step 4: confirmar GREEN e integridade do catálogo**

Run: `pnpm vitest run tests/unit/mcp-academia-information.test.ts tests/unit/capacidades-padrao-do-onboarding.test.ts tests/unit/catalogo-servido.test.ts tests/unit/catalogo-tools-leigo-friendly.test.ts tests/unit/tool-read-nao-muta.test.ts`

Expected: PASS e catálogo 1:1 com handlers.

- [ ] **Step 5: commit**

```bash
git add lib/mcp/tools/academia-information.ts lib/mcp/tools/index.ts lib/mcp/tools/catalogo/academia.ts lib/ai/agents/capacidades-padrao.ts tests/unit/mcp-academia-information.test.ts tests/unit/capacidades-padrao-do-onboarding.test.ts
git commit -m "feat(academia): permite IA consultar informações"
```

---

### Task 6: Prompt, sinal e gate anti-evasão

**Files:**
- Create: `tests/unit/academia-consulta-informacoes.test.ts`
- Create: `lib/academia/consulta-informacoes.ts`
- Create: `tests/unit/academia-information-prompt.test.ts`
- Create: `lib/agent-engine/agent/academia-information-prompt.ts`
- Create: `tests/unit/gate-academia-information-stall.test.ts`
- Modify: `lib/agent-engine/guardrails/before-send.ts`
- Modify: `lib/agent-engine/agent/inbound-turn.ts`
- Modify: `lib/agent-engine/agent/preview.ts`
- Modify: `lib/agent-engine/agent/preview.test.ts`

**Interfaces:**
- Produces: `sinalDeConversaSobreInformacoesAcademia`, `ACADEMIA_INFORMATION_SYSTEM_BLOCK`, `academiaInformationStallGate`.
- Consumes: execução real de `crm_get_academia_info`.

- [ ] **Step 1: escrever testes vermelhos de sinal e prompt**

```ts
expect(sinalDeConversaSobreInformacoesAcademia([
  { direction: "inbound", body: "Que horas abre segunda?" },
])).toBe(true);
expect(sinalDeConversaSobreInformacoesAcademia([
  { direction: "inbound", body: "Tem CrossFit segunda de manhã?" },
])).toBe(false);
expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toContain("crm_get_academia_info NESTE turno");
expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toContain("horário regular");
expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toContain("request_human_handoff");
```

- [ ] **Step 2: implementar sinal e prompt**

O sinal usa seis mensagens e termos inequívocos: endereço/localização, telefone/WhatsApp/e-mail/contato, abrir/fechar/funcionamento e regras da academia. Não usa “horário” sozinho, evitando colisão com grade. O prompt exige consulta, resposta imediata, preservação da abertura e fechamento, ausência explícita e handoff para exceção.

- [ ] **Step 3: escrever o teste vermelho do gate**

```ts
expect(academiaInformationStallGate.evaluate(baseCtx({
  body: "Vou verificar o horário e já retorno.",
  academiaInformation: { active: true, toolCalledThisTurn: false },
})).pass).toBe(false);
expect(academiaInformationStallGate.evaluate(baseCtx({
  body: "Na segunda, abrimos das 05:00 às 12:00.",
  academiaInformation: { active: true, toolCalledThisTurn: false },
})).pass).toBe(false);
expect(academiaInformationStallGate.evaluate(baseCtx({
  body: "Na segunda, o horário regular é das 05:00 às 12:00.",
  academiaInformation: { active: true, toolCalledThisTurn: true },
})).pass).toBe(true);
```

Adicionar caso de feriado com handoff que passa sem afirmação factual e caso no-op sem capacidade.

- [ ] **Step 4: implementar gate e wiring**

Adicionar `academiaInformation` aos contratos de before-send. Inserir o gate depois do gate da grade e antes de disclosure; incrementar `BEFORE_SEND_CHAIN_VERSION` para 9. No runtime e preview, armar apenas quando o agente publicado contém a tool e o sinal está presente; marcar execução somente no wrapper de `execute`. Incluir a tool em `SCENARIO_READS` e o prompt somente quando publicada.

- [ ] **Step 5: confirmar GREEN e regressão da grade**

Run: `pnpm vitest run tests/unit/academia-consulta-informacoes.test.ts tests/unit/academia-information-prompt.test.ts tests/unit/gate-academia-information-stall.test.ts tests/unit/gate-academia-grade-stall.test.ts lib/agent-engine/agent/preview.test.ts`

Expected: PASS; CrossFit continua armando somente o fluxo da grade.

- [ ] **Step 6: commit**

```bash
git add lib/academia/consulta-informacoes.ts lib/agent-engine/agent/academia-information-prompt.ts lib/agent-engine/guardrails/before-send.ts lib/agent-engine/agent/inbound-turn.ts lib/agent-engine/agent/preview.ts tests/unit/academia-consulta-informacoes.test.ts tests/unit/academia-information-prompt.test.ts tests/unit/gate-academia-information-stall.test.ts lib/agent-engine/agent/preview.test.ts
git commit -m "feat(academia): impede evasão da consulta operacional"
```

---

### Task 7: Documentação e verificação integral

**Files:**
- Modify: `docs/architecture/academia.md`
- Verify only: `.superpowers/evidence/`

**Interfaces:**
- Produces: arquitetura atualizada e evidência de conclusão.
- Consumes: Tasks 1–6.

- [ ] **Step 1: documentar o estado entregue**

Adicionar “Informações e funcionamento (0237)” com Tela → API → RPC → tabelas → tool → resposta. Registrar a direção futura de RAG: evento idempotente, reconciliação periódica, revisão/hash e tombstone; declarar expressamente que isso não foi implementado agora e que o banco prevalece.

- [ ] **Step 2: executar testes direcionados e banco**

```bash
pnpm vitest run tests/unit/academia-information.test.ts tests/unit/academia-information-api.test.ts tests/unit/mcp-academia-information.test.ts tests/unit/academia-consulta-informacoes.test.ts tests/unit/academia-information-prompt.test.ts tests/unit/gate-academia-information-stall.test.ts tests/unit/gate-academia-grade-stall.test.ts tests/unit/capacidades-padrao-do-onboarding.test.ts tests/unit/e2e-cobertura-completa.test.ts lib/agent-engine/agent/preview.test.ts
pnpm test:db
```

Expected: tudo PASS; baseline install e update OK.

- [ ] **Step 3: executar gates gerais**

```bash
pnpm gov:verify
pnpm build
pnpm test:shell
```

Expected: exit 0 e lint com 0 erros. Warnings herdados são relatados.

- [ ] **Step 4: executar Playwright isolado**

Usar os scripts E2E do repo sem abrir `.env*`, construir com `pnpm e2e:build`, iniciar produção em porta livre e executar:

```bash
pnpm playwright test tests/e2e/academia-informacoes-local.spec.ts tests/e2e/academia-grade-local.spec.ts tests/e2e/academia-cadastros-local.spec.ts tests/e2e/academia-modulo-local.spec.ts --workers=1
```

Expected: tudo PASS, screenshots desktop/mobile legíveis, sem overflow ou page errors.

- [ ] **Step 5: revisar e commit final**

```bash
git diff --check
git status --short
git add docs/architecture/academia.md
git commit -m "docs(academia): registra informações operacionais"
```

- [ ] **Step 6: preparar integração**

Confirmar que os três untracked do usuário permanecem intocados. Buscar `origin/main`; se avançou, integrar por merge e repetir gates afetados. Então usar `finishing-a-development-branch` para revisar e integrar a entrega autorizada.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { tool } from "ai";
import { z } from "zod";
import type { PublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";
import { resolveConversationTurn } from "@/lib/agent-engine/agent/resolve-turn-agent";
import { buildMcpTurnTools } from "@/lib/agent-engine/edge/crm/mcp-tools";

// Só as bordas de publicação/MCP e o provedor são simulados. O turno, wrappers,
// gates, fila, envio e handoff nativo executam contra Postgres efêmero real.
vi.mock("@/lib/agent-engine/agent/resolve-turn-agent", () => ({ resolveConversationTurn: vi.fn() }));
vi.mock("@/lib/agent-engine/edge/crm/mcp-tools", () => ({ buildMcpTurnTools: vi.fn() }));

if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 2,
});
const ORG = "aaca0000-0000-4000-8000-000000000001";
const CONTACT = "aaca0000-0000-4000-8000-000000000002";
const SESSION = "aaca0000-0000-4000-8000-000000000003";
const CONV = "aaca0000-0000-4000-8000-000000000004";
const AGENT = "aaca0000-0000-4000-8000-000000000005";
const config: PublishedAgentConfig = {
  agentId: AGENT, versionId: "aaca0000-0000-4000-8000-000000000006",
  agentName: "Academia teste", systemPrompt: "Responda consultando o cadastro.",
  provider: "anthropic", model: "claude-sonnet-4-5", credentialId: null,
  maxSteps: 12, historyMessageWindow: 10, historyTokenWindow: 4000,
  handoffKeywords: [], handoffToolEnabled: false, splitMessages: false,
  splitMaxChars: 1000, multimodalInput: false, casesEnabled: false,
  toolIds: ["crm_get_academia_info"], knowledgeSourceIds: [], activeKbVersionId: null,
  ragTopK: 5, ragSimilarityThreshold: 0.4, operatorEnabled: false,
  operatorModel: null, operatorToolIds: [], pipelineIds: [], janelaDeAtendimento: null,
  versionCreatedBy: null, agentCreatedBy: null,
};
type Call = { name: string; args: Record<string, unknown> };
const consulta = (subject: string): Call => ({ name: "crm_get_academia_info", args: { subject } });
const handoff: Call = { name: "request_human_handoff", args: { reason: "Confirmação operacional" } };
const resposta: Call = { name: "send_message", args: { body: "Na segunda, abrimos às 05:00. Ficamos na Rua de Teste, 10." } };
let enviados: Array<{ body: string; forceHumanNoEnvio: boolean }> = [];
let resultados: unknown[] = [];
let falhaConsulta = false;

beforeAll(async () => {
  await pool.query(`insert into organizations (id,slug,legal_name,display_name)
    values ($1,'academia-turno','Academia Teste','Academia Teste')`, [ORG]);
  await pool.query(`insert into channel_sessions (id,organization_id,waha_session_name,status,webhook_secret_encrypted)
    values ($1,$2,'academia-turno','WORKING','\\x00'::bytea)`, [SESSION, ORG]);
  await pool.query(`insert into ai_agents (id,organization_id,name,system_prompt)
    values ($1,$2,'Academia teste','Consulte o cadastro')`, [AGENT, ORG]);
  await pool.query(`with v as (
    insert into playbook_versions (organization_id,layer,content)
    select null,'platform',E'## Identidade\nAssistente de teste.'
    where not exists (select 1 from playbook_pointers where organization_id is null and layer='platform')
    returning id)
    insert into playbook_pointers (organization_id,layer,version_id) select null,'platform',id from v`);
});
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  enviados = []; resultados = []; falhaConsulta = false;
  for (const table of ["messages", "send_ledger", "outbound_copies", "agent_inbox_items", "conversations", "contacts"]) {
    await pool.query(`delete from ${table} where organization_id=$1`, [ORG]);
  }
  await pool.query(`insert into contacts (id,organization_id,name,phone_number,force_human)
    values ($1,$2,'Lead de teste','+5511900000888',false)`, [CONTACT, ORG]);
  await pool.query(`insert into conversations (id,organization_id,contact_id,channel_session_id,status,is_group)
    values ($1,$2,$3,$4,'ai_handling',false)`, [CONV, ORG, CONTACT, SESSION]);
  vi.mocked(resolveConversationTurn).mockResolvedValue({
    config, routerId: null, intentName: null, confidence: null, outcome: "no_router",
  });
  vi.mocked(buildMcpTurnTools).mockImplementation(async () => ({
    toolIds: ["crm_get_academia_info"], cleanup: async () => {},
    tools: { crm_get_academia_info: tool({
      description: "Consulta oficial", inputSchema: z.object({ subject: z.enum(["address", "opening_hours", "contact", "rules"]) }),
      execute: async ({ subject }) => falhaConsulta
        ? { error: "consulta indisponível" }
        : { source: "cadastro_operacional", subject, missing_fields: [],
            ...(subject === "address" ? { address: "Rua de Teste, 10" } : { opening_hours: { opens_at: "05:00" } }) },
    }) },
  }));
});

async function roda(texto: string, calls: Call[]) {
  const { createInboundTurnHandler } = await import("@/lib/agent-engine/agent/inbound-turn");
  const queue = await import("@/lib/agent-engine/queue/queue");
  const { createFakeRegistry } = await import("@/lib/agent-engine/edge/llm/providers");
  const { createLogger } = await import("@/lib/agent-engine/obs/logger");
  let index = 0;
  const handler = createInboundTurnHandler({
    crmCfg: { supabase: {} as never }, llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: { historyLimit: 10, maxContextTokens: 4000, notesIndexMaxTokens: 500,
      maxSteps: 12, queuedRetryDelayMs: 1000,
      breaker: { exactFailureWarn: 2, exactFailureBlock: 5, sameToolFailureWarn: 3,
        sameToolFailureHalt: 8, noProgressWarn: 3, noProgressBlock: 5 } },
    log: createLogger(),
    registry: createFakeRegistry((async (opts: { prompt?: unknown; tools?: Array<{ name: string }> }) => {
      for (const msg of (opts.prompt ?? []) as Array<{ content?: unknown }>) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content as Array<Record<string, unknown>>) {
          if (part.type === "tool-result") resultados.push(part.output);
        }
      }
      const call = opts.tools?.some((t) => t.name === "send_message") ? calls[index++] : undefined;
      return {
        content: call
          ? [{ type: "tool-call", toolCallId: `c${index}`, toolName: call.name, input: JSON.stringify(call.args) }]
          : [{ type: "text", text: JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: "turno teste" }) }],
        finishReason: { unified: call ? "tool-calls" : "stop", raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      };
    }) as never),
    channel: () => ({ channel: "captura", send: async (i: { body: string }) => {
      const { rows } = await pool.query("select force_human from contacts where id=$1", [CONTACT]);
      enviados.push({ body: i.body, forceHumanNoEnvio: rows[0].force_human });
      return { kind: "sent", idempotencyKey: `k${enviados.length}`, messageId: `m${enviados.length}` };
    }, sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
    capabilities: () => ({ freeform: true, media: true, audio: true }),
    costPerMessage: () => ({ currency: "BRL", cents: 0 }) }) as never,
    clock: () => new Date("2026-07-28T18:00:00Z"), sleep: async () => {},
  });
  const msg = crypto.randomUUID();
  await pool.query(`insert into messages (id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at)
    values ($1,$2,$3,$4,$5,'text','inbound','delivered',$6,'external_device',now())`, [msg, ORG, CONV, SESSION, CONTACT, texto]);
  await pool.query("update job_queue set status='done' where status='pending'");
  const { job } = await queue.enqueueJob(pool, ORG, { kind: "inbound_turn", leadId: CONTACT,
    payload: { conversation_id: CONV, contact_id: CONTACT, channel_session_id: SESSION, inbound_message_id: msg, crm_event_id: crypto.randomUUID() }, maxAttempts: 1 });
  const [claimed] = await queue.claimJobs(pool, { workerId: "academia-info", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  await handler(claimed!, pool, { workerId: "academia-info" });
  await queue.completeJob(pool, claimed!.id, "academia-info");
}

async function estado() {
  const { rows } = await pool.query(`select c.force_human,v.status,v.bot_silenced_until::text as silencio,
    (select count(*)::int from agent_inbox_items where organization_id=$2 and kind='handoff') as handoffs
    from contacts c join conversations v on v.contact_id=c.id where c.id=$1`, [CONTACT, ORG]);
  return rows[0];
}

describe("informações operacionais no turno nativo", () => {
  it("handoff imediato não contorna consulta disponível nem envia aviso", async () => {
    await roda("Que horas abre na segunda?", [handoff]);
    expect(JSON.stringify(resultados)).toContain("academia_information_consult_first");
    expect(enviados).toHaveLength(0);
    expect(await estado()).toMatchObject({ force_human: false, status: "ai_handling", handoffs: 0 });
  });
  it("assunto errado não libera envio nem passagem", async () => {
    await roda("Que horas abre na segunda?", [consulta("address"), resposta, handoff]);
    expect(JSON.stringify(resultados)).toContain("academia_information_consult_first");
    expect(enviados).toHaveLength(0);
    expect((await estado()).force_human).toBe(false);
  });
  it("consulta parcial de dois assuntos ainda bloqueia a resposta", async () => {
    await roda("Onde fica e que horas abre?", [consulta("opening_hours"), resposta]);
    expect(enviados).toHaveLength(0);
  });
  it("todos os assuntos consultados liberam uma resposta real", async () => {
    await roda("Onde fica e que horas abre?", [consulta("opening_hours"), consulta("address"), resposta]);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.body).toContain("05:00");
    expect((await estado()).force_human).toBe(false);
  });
  it.each(["falha", "ausente", "sem execute", "feriado"])("fallback %s avisa antes de silenciar e grava a passagem", async (modo) => {
    falhaConsulta = modo === "falha";
    if (modo === "ausente") vi.mocked(buildMcpTurnTools).mockResolvedValue(null);
    if (modo === "sem execute") vi.mocked(buildMcpTurnTools).mockResolvedValue({
      tools: { crm_get_academia_info: tool({ description: "Sem execução", inputSchema: z.object({ subject: z.string() }) }) },
      toolIds: ["crm_get_academia_info"], cleanup: async () => {},
    });
    await roda(modo === "feriado" ? "E no feriado?" : "Que horas abre?", [
      ...(modo === "falha" ? [consulta("opening_hours")] : []), handoff,
    ]);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.forceHumanNoEnvio).toBe(false);
    expect(await estado()).toMatchObject({ force_human: true, status: "pending", silencio: "infinity", handoffs: 1 });
  });
});

# Academia · informações gerais e funcionamento — design

> Data: 2026-09-11 · Estado: aprovado pelo usuário  
> Continuidade: etapa posterior à consulta estruturada da grade semanal pela IA.

Neste documento, **CONFIRMADO** identifica comportamento já provado no código e
**DECISÃO APROVADA** identifica o contrato desta nova entrega. Não há regra de
negócio inferida.

## 1. Resultado contratado

O módulo Academia passa a manter uma fonte estruturada e tenant-aware para as
informações públicas da unidade: endereço, contatos, fuso horário, regras e
funcionamento semanal. A IA consulta essa fonte diretamente antes de responder
perguntas sobre esses assuntos.

A entrega resolve perguntas como:

- "Qual é o endereço da academia?"
- "Qual é o WhatsApp?"
- "Que horas abre na segunda-feira?"
- "A academia fecha no horário do almoço?"
- "Quais são as regras para treinar?"

Horário de funcionamento e grade de aulas são domínios diferentes. A pergunta
"que horas a academia abre?" usa as informações gerais; "tem CrossFit segunda
de manhã?" continua usando `crm_find_academia_classes` e a grade semanal.

## 2. Decisões aprovadas

### 2.1 Fonte oficial

A fonte de verdade é o banco relacional. Os dados não ficam armazenados somente
em prompt, documento ou índice vetorial. O RAG poderá receber uma projeção desses
registros no futuro, mas nunca prevalece sobre o cadastro operacional.

### 2.2 Informações gerais

O cadastro contém:

- endereço completo em texto livre;
- telefone;
- WhatsApp;
- e-mail;
- regras e orientações públicas em texto livre;
- fuso horário da organização já existente no schema.

Telefone, WhatsApp e e-mail são campos separados. Campos não preenchidos são
representados como ausentes; a IA não inventa um valor nem substitui um canal
pelo outro.

### 2.3 Funcionamento semanal

Cada dia da semana aceita zero ou um período contínuo:

- zero períodos significa dia fechado;
- um período representa abertura e fechamento, como `05:00–23:00`.

O horário de abertura deve ser anterior ao fechamento. Nesta etapa, o período
não atravessa a meia-noite. A unidade informada não costuma fechar durante o dia,
portanto intervalos internos não fazem parte do contrato desta entrega.

Os horários representam a semana regular no fuso da organização. Feriados,
recessos, fechamentos extraordinários e outras exceções de calendário pertencem
a uma etapa posterior.

## 3. Alternativas consideradas

### A. Tabelas próprias — escolhida

Um registro de informações gerais por organização e períodos semanais
estruturados. Permite validação, RLS, auditoria, concorrência controlada e
consulta determinística pela IA.

### B. JSON em `organizations.settings` — recusada

Reduziria o trabalho inicial, mas enfraqueceria invariantes de horário,
consultas, evolução de schema e testes de isolamento.

### C. Documento somente no RAG — recusada como fonte oficial

É flexível para texto narrativo, porém pode ficar defasado e não oferece a mesma
segurança para respostas exatas de dia, hora e canal de contato.

## 4. Modelo de dados

### 4.1 `academia_profiles`

Um registro por organização, identificado por `organization_id`, contém:

- endereço completo;
- telefone;
- WhatsApp;
- e-mail;
- regras públicas;
- número de revisão;
- datas de criação e alteração.

O fuso horário não é duplicado nessa tabela. **CONFIRMADO:** a leitura e a
atualização usam `organizations.timezone`, campo que já existe no schema e será
a fonte canônica.

### 4.2 `academia_opening_hours`

Cada registro representa um período de um dia da semana e contém:

- identificador;
- `organization_id`;
- dia ISO da semana, de 1 (segunda-feira) a 7 (domingo);
- hora local de abertura;
- hora local de fechamento;
- datas de criação e alteração.

A ausência de registros para um dia representa "fechado". Não é necessário um
booleano concorrente que possa divergir dos períodos.

### 4.3 Invariantes e isolamento

As duas tabelas são tenant-aware e têm RLS por organização. Além da validação da
borda, o banco impede:

- dia fora de 1–7;
- abertura igual ou posterior ao fechamento;
- mais de um período para a mesma organização e dia;
- mais de um perfil para a mesma organização.

A atualização do perfil e da semana regular ocorre atomicamente, com controle
de revisão, incluindo eventual mudança de `organizations.timezone`. Duas pessoas
editando a mesma configuração não podem sobrescrever silenciosamente uma à
outra.

A migration não cria endereço, contato, regras nem períodos padrão para
organizações existentes. O estado inicial é vazio até uma pessoa autorizada
salvar dados confirmados.

Como há mudança de schema, a implementação exige migration nova, apêndice
idempotente em `supabase/baseline.sql` e registro em
`supabase/migrations/MANIFEST.md`. Qualquer função pública criada para garantir a
operação atômica terá `EXECUTE` revogado de `public` e `anon`, com concessão
somente ao papel necessário.

## 5. API e autorização

A superfície versionada de Academia expõe leitura e atualização do documento de
informações e funcionamento. O contrato externo usa `snake_case`.

### Leitura

Retorna:

- os cinco campos públicos do perfil;
- o fuso horário canônico da organização;
- os sete dias, inclusive os fechados;
- os períodos ordenados por abertura;
- a revisão atual.

Usuários autenticados da organização podem ler quando o módulo Academia está
habilitado.

### Atualização

Recebe o perfil, o fuso horário, a semana completa e a revisão observada pelo
cliente. A rota:

1. valida o corpo com Zod;
2. aplica o gate do módulo Academia;
3. exige o mesmo papel administrativo já usado nas mutações do módulo;
4. deriva a organização da autenticação, nunca do corpo;
5. grava perfil, fuso horário e períodos em uma transação;
6. registra auditoria sem copiar dados pessoais para logs;
7. responde com `ok()` ou `fail()`.

Uma revisão desatualizada produz conflito explícito e pede recarga da tela.

## 6. Experiência na interface

A área autenticada de Academia ganha a aba **Informações**, ao lado de Grade e
Cadastros.

A aba contém três blocos:

1. **Dados gerais** — endereço, telefone, WhatsApp, e-mail e fuso horário.
2. **Funcionamento semanal** — sete dias, controle de fechado e um par de
   horários de abertura/fechamento para cada dia aberto.
3. **Regras e orientações** — campo de texto livre.

Ao marcar um dia como fechado, a tela remove seu período somente no estado
local; a gravação ocorre ao salvar o formulário completo. A tela valida formato,
ordem e completude antes do envio, sem depender disso como única proteção.

Alterações ainda não persistidas ficam visíveis. Sucesso, erro de validação e
conflito de revisão têm mensagens próprias. Perfis sem permissão veem os dados,
mas não recebem controles de edição.

## 7. Ferramenta direta da IA

Uma ferramenta read-only separada da grade consulta as informações oficiais da
academia. O nome previsto é `crm_get_academia_info`; a implementação deve validar
o nome contra as convenções atuais do catálogo antes de fixá-lo.

A entrada identifica o assunto solicitado — endereço, contato, funcionamento ou
regras — e aceita opcionalmente o dia da semana quando o assunto for
funcionamento. Não aceita `organization_id`; o tenant vem do contexto confiável
do agente.

A saída contém somente dados próprios para resposta ao cliente, acompanhados de:

- natureza da fonte (`cadastro_operacional`);
- fuso horário;
- indicação de semana regular;
- campos ausentes de forma explícita;
- data de atualização.

Para funcionamento sem um dia específico, a ferramenta devolve a semana
regular. Para "hoje" ou "agora", a interpretação usa o fuso da organização e a
resposta declara que se trata do horário regular. Se a mensagem mencionar
feriado, recesso ou exceção, a IA não confirma o funcionamento: informa a
limitação atual e usa o handoff disponível.

## 8. Comportamento e anti-invenção

Quando a capacidade estiver publicada no agente, perguntas sobre endereço,
contatos, funcionamento ou regras exigem execução da ferramenta no turno antes
da resposta factual.

O prompt residente orienta o modelo a:

- não responder esses dados de memória, prompt ou RAG;
- distinguir funcionamento geral de grade de aulas;
- dizer claramente quando um campo não está cadastrado;
- não prometer consulta futura quando a ferramenta pode responder agora;
- encaminhar perguntas sobre exceções ainda não representadas.

O runtime terá um gate determinístico contra respostas factuais e promessas de
"vou consultar" sem execução da ferramenta, seguindo o padrão já adotado na
consulta da grade. Uma falha técnica não autoriza invenção; nesse caso, o agente
explica a indisponibilidade e faz handoff.

## 9. Estratégia futura de sincronização com o RAG

Esta seção é uma decisão de direção, não escopo de implementação desta entrega.

O RAG será uma projeção derivada para perguntas narrativas e descoberta
semântica. A sincronização futura deve combinar dois mecanismos:

1. **Atualização orientada a evento:** cada gravação confirmada emite um evento
   idempotente com organização, tipo da entidade, identificador e revisão.
2. **Reconciliação periódica:** um job compara a revisão/hash da fonte com o
   documento indexado e corrige eventos perdidos, documentos antigos e remoções.

Cada documento derivado deverá carregar ao menos:

- `organization_id` para isolamento;
- tipo e identificador estável da fonte;
- revisão ou `updated_at` da fonte;
- hash do conteúdo normalizado;
- instante da última indexação;
- estado ativo ou removido.

O consumidor ignora eventos de revisão anterior à já indexada. Exclusões e
desativações geram tombstone ou remoção idempotente. Métricas futuras devem
permitir detectar atraso, falhas e divergências sem registrar telefone, e-mail
ou conteúdo integral em logs.

Em qualquer divergência, a ferramenta estruturada consulta o banco e prevalece.
O RAG não confirma horário, contato ou regra operacional contra uma versão mais
nova da fonte.

## 10. Testes e evidências

### Banco

- instalação e atualização do baseline;
- RLS e isolamento entre duas organizações;
- perfil único por organização;
- rejeição de período inválido e de mais de um período no mesmo dia;
- atualização atômica e conflito de revisão.

### Unidade e API

- validação e projeção da semana completa;
- dias fechados e um período contínuo por dia aberto;
- leitura e mutação por papel;
- módulo desabilitado;
- ausência de campos e falha técnica;
- auditoria e contrato `snake_case`.

### Agente

- ferramenta publicada e autorizada;
- filtro explícito por organização;
- resposta de endereço, contato, regras e funcionamento;
- distinção entre funcionamento e grade;
- bloqueio de resposta sem consulta;
- handoff para feriado ou exceção.

### E2E e prova visual

- abrir a aba Informações;
- salvar dados gerais e regras;
- cadastrar abertura e fechamento em um dia;
- marcar um dia como fechado;
- validar abertura posterior ao fechamento;
- confirmar leitura sem edição para papel não autorizado;
- testar a conversa "que horas abre segunda?";
- confirmar que "tem CrossFit segunda de manhã?" ainda usa a grade.

Além dos testes específicos, a conclusão exige os gates proporcionais à mudança:
typecheck, lint, testes unitários, banco, build e E2E relevante.

## 11. Fora do escopo

- planos e preços;
- feriados e exceções de calendário;
- reservas, vagas, matrículas, presença ou pagamentos;
- sincronização efetiva com o RAG;
- confirmação de funcionamento extraordinário.

Esses itens não podem ser inferidos a partir dos dados desta etapa. O roadmap
continua responsável por ordenar as próximas entregas.

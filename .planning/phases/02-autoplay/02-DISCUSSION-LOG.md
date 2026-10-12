# Phase 2: Autoplay — Discussion Log

**Date:** 2026-10-12
**Mode:** interactive (`discuss`), PT-BR
**Reference only** — não consumido por agentes downstream; o canônico é `02-CONTEXT.md`.

## Seleção de áreas

Pergunta: Quais áreas do Autoplay discutir? (multiSelect)
Opções: Política de hunt · Compra de bolas/potions · Venda de loot · Rotina e horários · Reação a eventos · Config por conta na UI · Persistência do supervisor (SUP).
**Selecionado:** todas as 7.

## Área: Política de hunt

- Q: Como cada conta escolhe a hunt?
  Opções: Fixa por conta / Automática por força / Fixa com fallback auto.
  **Resposta (livre):** "o usuário vai poder escolher: hunt fixa via slug ou a mais otimizada (trataremos como obter isso depois)". → D-01.
- Q: O que fazer no stall (hunt sem kill)?
  Opções: Só recuperar (hoje) / Trocar de hunt / Recuperar e avisar.
  **Resposta:** Só recuperar (hoje). → D-02.
- Q: Restrição de hunts elegíveis?
  Opções: Excluir cidades/gyms (hoje) / Lista branca por conta / Você decide depois.
  **Resposta:** Excluir cidades/gyms (hoje). → D-03.

## Área: Compra de bolas/potions

- Q: Qual pokébola comprar?
  Opções: Uma fixa por conta / A mais barata viável / Você decide depois.
  **Resposta:** Uma fixa por conta. → D-04.
- Q: Estoque mínimo (disparo)?
  Opções: Abaixo de 100 (ref.) / Configurável por conta / Você decide depois.
  **Resposta:** Configurável por conta. → D-05.
- Q: Quanto comprar por vez?
  Opções: Repor até um teto / Lote fixo / Você decide depois.
  **Resposta:** Repor até um teto. → D-06.
- Q: Teto de gold e potions?
  Opções: Gastar livre só bolas / Comprar bolas + potions / Reservar gold mínimo.
  **Resposta (livre):** "poções devem ser priorizadas em prol das pokebolas". → D-07 (potions têm prioridade sobre bolas; endpoint a confirmar na Fase 1).

## Área: Venda de loot

- Q: O que vender / guardar?
  Opções: Vender tudo exceto whitelist / Vender só whitelist / Você decide depois.
  **Resposta:** Vender tudo exceto whitelist. → D-08.
- Q: Onde vender?
  Opções: Só loja NPC / Incluir mercado de jogadores / Você decide depois.
  **Resposta:** Só loja NPC. → D-09.
- Q: Quando vender?
  Opções: Periódico / Quando encher / Você decide depois.
  **Resposta:** Periódico. → D-10.
- Q: Vender pokémon capturados automaticamente?
  Opções: Nunca vender pokémon / Vender duplicados/fracos / Você decide depois.
  **Resposta:** Vender duplicados/fracos. → D-11 (critério + endpoint em aberto, Fase 1).

## Área: Rotina e horários

- Q: Contínuo ou com pausas?
  Opções: Contínuo 24h / Sessões com pausas / Você decide depois.
  **Resposta:** Contínuo 24h. → D-12.
- Q: Janela ativa por conta?
  Opções: Dia todo / Janela por conta / Você decide depois.
  **Resposta:** Dia todo. → D-12.
- Q: Humanização além do jitter?
  Opções: Manter só o jitter / Adicionar variação de rotina / Você decide depois.
  **Resposta:** Manter só o jitter. → D-12.

## Área: Reação a eventos

- Q: sleep-mode no drain?
  Opções: Condicional à Fase 1 / Sempre enviar / Nunca.
  **Resposta:** Condicional à Fase 1. → D-13.
- Q: field-teleport-city (time derrotado)?
  Opções: Voltar à hunt (hoje) / Curar antes de voltar / Você decide depois.
  **Resposta:** Curar antes de voltar. → D-14 (mecanismo de cura a confirmar, Fase 1).
- Q: Limites dos watchdogs/backoff?
  Opções: Manter e revisar na Fase 1 / Revisar agora.
  **Resposta:** Manter e revisar na Fase 1. → D-15.

## Área: Config por conta na UI

- Q: Quais parâmetros por conta?
  Opções: Essenciais + resto global / Tudo por conta / Você decide depois.
  **Resposta:** Tudo por conta. → D-16.
- Q: Valores padrão?
  Opções: Defaults + override / Obrigatório por conta / Você decide depois.
  **Resposta:** Defaults + override. → D-17.
- Q: Onde na UI?
  Opções: Estender AccountForm / Aba/página separada / Você decide depois.
  **Resposta:** Aba/página separada. → D-18.

## Exploração adicional: Dashboard de cards + fluxo de conta

Contexto: usuário forneceu 2 mockups (painel de SESSÃO e painel do TREINADOR) e descreveu uma tela de cards (1 por conta) com pokémon ativo + resumo da sessão, e um `+` para adicionar/criar conta.
Esclarecimento do assistente: não viu a UI do jogo ao vivo (restrição); mapeou campos disponíveis (via `analyzer`/`balls`/`pokes`/contadores) vs campos sem fonte confirmada (XP/h, diamantes, gemas, VIP, drops raros, nível do treinador) que ficam bloqueados até a Fase 1.

- Q: O que é "criar conta do zero" no `+`?
  Opções: Só adicionar existente agora / Incluir registro do zero agora / Você decide depois.
  **Resposta inicial:** Incluir registro do zero agora.
- Pushback do assistente (risco/escopo): Turnstile no registro (solver não comprovado — VAL-01 ainda vai testar no login), verificação de e-mail não automatizável sem integração de inbox, `/create-character` não mapeado (GAME.md §8), e registro está fora da fronteira AUTO/SUP da Fase 2 (muda ROADMAP → coordenador reconcilia).
  Q: Como tratar registro do zero?
  Opções: Fase própria (recomendado) / Expandir a Fase 2 agora / Só registrar a visão.
  **Resposta:** Fase própria (recomendado). → Deferred + nota ao coordenador. D-21 mantém o ponto de entrada no `+`.
- Q: Campos do card no v1?
  Opções: Essenciais já disponíveis / Tudo do mockup já / Você decide depois.
  **Resposta:** Tudo do mockup já. → D-19/D-20 (campos sem fonte bloqueados até Fase 1).
- Q: Como os cards atualizam?
  Opções: Tempo real (SSE) / Intervalo / Você decide depois.
  **Resposta:** Tempo real (SSE). → D-22.
- Q: Incluir COPIAR e RESET por card?
  Opções: Incluir ambos / Só exibir / Você decide depois.
  **Resposta:** Incluir ambos. → D-23 (RESET → `analyzer-clear`).

## Área: Persistência do supervisor (SUP)

- Q: Onde persistir o estado desejado?
  Opções: Arquivo no volume /data / Na central (API) / Você decide depois.
  **Resposta:** Na central (API). → D-24.
- Q: Como religar no boot?
  Opções: Reconciliar no startup / Religar com confirmação / Você decide depois.
  **Resposta:** Reconciliar no startup. → D-25.
- Q: Fonte do refresh token na recriação?
  Opções: Central é a fonte / Cache local + central / Você decide depois.
  **Resposta:** Central é a fonte. → D-26.

## Fechamento

Usuário confirmou "Escrever o CONTEXT.md" após revisar o resumo das 7 áreas + dashboard.

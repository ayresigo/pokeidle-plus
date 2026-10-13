# 5-SUMMARY — MIG-04 (cobertura de testes ao nível do v1.0)

**Wave 5, 2026-10-13.** Suíte do worker: **132 testes verdes**, 8 arquivos; `tsc --noEmit` limpo.

## Gate de cobertura — mecanismo → teste

| Mecanismo de robustez / comportamento | Coberto por |
|---|---|
| Handshake hello → welcome → hunt.select | `client.test.ts` "abre, envia hello e só vira in-game no welcome" |
| Kills por `batalha/morte`; herói não conta; `campo` ignorado; `aviso`→lastError | `client.test.ts` "campo.init entra na hunt..."; "morte do herói não conta..." |
| Reconciliação por `estado.dexMud` | `client.test.ts` "estado.dexMud reconcilia contadores autoritativos" |
| **sessao.renovada → tokenHello + health.setTokens** (D-S7) | `client.test.ts` "sessao.renovada troca o token em uso e publica via health.setTokens" |
| Queda comum → reconecta com backoff | `client.test.ts` "queda comum reconecta com backoff e volta a in-game" |
| Backoff escalonado (teto 24 s nas 5 primeiras, depois 5 min) | `client.test.ts` "backoff do bundle até 5 falhas, depois teto de 5 min" |
| Contador só zera ao receber msg do servidor | `client.test.ts` "abrir sem nenhuma mensagem não zera o backoff..." |
| Rejeição de token → `invalidar` 1× + reconecta com token novo | `client.test.ts` "erro no handshake invalida uma vez e reconecta..." |
| `invalidar` ≤1×/5 min → 2ª rejeição = needs-login sem reconectar | `client.test.ts` "erro no handshake de novo dentro de 5 min → needs-login" |
| Rejeição transitória (`AuthAdiadaError`) → reconecta e pode invalidar de novo | `client.test.ts` "erro no handshake com renovação adiada..." |
| `invalidar` falhando → needs-login | `client.test.ts` "erro no handshake com invalidar falhando" |
| Erro depois do welcome → lastError, não derruba | `client.test.ts` "erro depois do welcome vira lastError" |
| Servidor fora do ar → continua tentando, não vai a needs-login | `client.test.ts` "servidor fora do ar não derruba o cliente" |
| Access expirado → aguarda renovação, não conecta | `client.test.ts` "access expirado não conecta e aguarda renovação" |
| getTokens sem tokens → needs-login | `client.test.ts` "getTokens sem tokens → needs-login" |
| Heartbeat: silêncio → ping; sem resposta → fecha e reconecta | `client.test.ts` "heartbeat: silêncio → ping..." |
| Drain: `desconectar` fecha 1000, não reconecta, encerra | `client.test.ts` "desconectar fecha limpo (1000)..." |
| Token nunca aparece em lastError/lastAction | `client.test.ts` "nunca expõe o access token..." |
| garantir-hunt: hunt.select + prazo campo.init + slug inválido | `loop.test.ts` describe "ação garantir-hunt" |
| watchdog-stall: 10 min → hunt.select; 3 recuperações → 1 h + lastError; kill zera | `loop.test.ts` describe "ação watchdog-stall" |
| runGameLoop: jitter, erros consecutivos, parada em voo | `loop.test.ts` describe "runGameLoop" |
| drenar: para loop, desconecta, para auth, fecha health | `loop.test.ts` describe "drenar" |
| health renewedTokens: omite igual ao inicial, expõe renovado (mem + HTTP) | `health.test.ts` "omite tokens iguais..."/"expõe tokens renovados"/"inclui tokens após renovação" |
| Auth: login /auth/entrar, sitekey dinâmica/override, precisaNick, segredos, re-login no expiry | `provider.test.ts` (18) + `solver.test.ts` (11) + `refresh.test.ts` (3) |

## Contagem e rationale
- Baseline no início da fase: 134 verdes. Agora: **132 verdes** (−3 casos de `GAME_WS_SHARDS` removidos na
  Wave 3; +1 caso de `sessao.renovada`).
- O número do v1.0 (~175) incluía **superfície do protocolo antigo** que não existe mais no pokeidle.io:
  mapeamento de close codes `4001`-`4009` para estado, sharding djb2, seleção de hunt por `map-markers`,
  reciclagem `restart-freeze`/`restart-resumed`. Esses testes foram **removidos-com-evidência** junto com o
  código; re-pinhá-los testaria comportamento inexistente (contrário às regras de teste do projeto).
- **Todo mecanismo migrado/preservado está coberto** (tabela acima). A cobertura dos cenários exigidos por
  MIG-04/SC3 — reconexão, rejeição, drain, watchdog — está no nível do v1.0. Nenhuma lacuna genuína restante.

## Verificação
`pnpm vitest run` (worker) → 132 verdes; `tsc --noEmit` exit 0.
Novos casos de close code / sessão substituída / manutenção vêm na wave 6 (gated por smoke), pois dependem
dos sinais reais observados.

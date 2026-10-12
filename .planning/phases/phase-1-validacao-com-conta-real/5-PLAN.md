---
phase: 1-validacao-com-conta-real
plan: 5
type: execute
wave: 5
depends_on: [1, 2, 3, 4]
files_modified:
  - packages/worker/GAME.md
  - .planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
autonomous: true
requirements: [VAL-07]
must_haves:
  truths:
    - "Todo ponto de GAME.md §9 (9.1 e 9.2) está marcado como confirmado, refutado ou não-observável + data"
    - "Cada marca de §9 tem um trecho de evidência sanitizado correspondente em EVIDENCE.md"
    - "A suíte do worker está verde (baseline ≥175 testes), incluindo os casos novos"
    - "Nenhum segredo (token/senha/solver key) aparece em GAME.md, EVIDENCE.md ou nos commits"
  artifacts:
    - path: "packages/worker/GAME.md"
      provides: "§9 completamente marcado e coerente com o código final"
    - path: ".planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md"
      provides: "Trilha de evidência sanitizada completa (D-07)"
  key_links:
    - from: "GAME.md §9 (todas as marcas)"
      to: "suíte do worker verde + EVIDENCE.md"
      via: "gate final da fase"
      pattern: "confirmado|refutado|não-observável"
---

<objective>
Gate final da Phase 1: provar que o worker funciona (e está ajustado) contra o jogo real.

Purpose: Fechar VAL-07 e o Success Criterion 5 do ROADMAP — todo ponto de §9 marcado e cada
divergência corrigida com teste, suíte verde.

Output: confirmação de que (1) todos os pontos de GAME.md §9.1/§9.2 têm marca + data com
evidência sanitizada em EVIDENCE.md; (2) a suíte do worker está verde (≥175 testes); (3)
nenhum segredo vazou para arquivo/commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/phase-1-validacao-com-conta-real/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
@.planning/phases/phase-1-validacao-com-conta-real/2-SUMMARY.md
@.planning/phases/phase-1-validacao-com-conta-real/3-SUMMARY.md
@.planning/phases/phase-1-validacao-com-conta-real/4-SUMMARY.md
@packages/worker/GAME.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fechar a trilha de evidência e marcar §9 por completo</name>
  <files>packages/worker/GAME.md, .planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md</files>
  <action>
    Percorrer TODOS os pontos de GAME.md §9.1 e §9.2 e garantir que cada um tem marca
    (confirmado/refutado/não-observável) + data e um trecho de evidência correspondente em EVIDENCE.md.
    Pontos que a execução não conseguiu observar (ex.: 4007 não disparou, farm offline não medível na janela)
    ficam explicitamente "não-observável" + data + motivo. Conferir manualmente que NENHUM token, senha,
    identifier, captchaToken ou solver key aparece em GAME.md nem em EVIDENCE.md (substituir por `<redacted>`
    se necessário). Sem comentários em linhas de código.
  </action>
  <verify>
    <automated>grep -rniE "accessToken|refreshToken|captchaToken|SOLVER_KEY|password|identifier.*:" packages/worker/GAME.md .planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md || echo "sem segredos"</automated>
  </verify>
  <done>§9.1 e §9.2 100% marcados + data; cada marca com evidência; nenhum segredo em GAME.md/EVIDENCE.md.</done>
</task>

<task type="auto">
  <name>Task 2: Gate de suíte verde do worker</name>
  <files>packages/worker</files>
  <action>
    Rodar a suíte do worker e confirmar que está verde, com no mínimo a baseline de 175 testes mais os casos
    adicionados (instrumentação do 1-PLAN e correções do 4-PLAN). Se algum teste falhar, voltar ao plano
    correspondente (não contornar aqui). Não alterar código neste passo além do necessário para o gate
    (este plano não introduz correção nova).
  </action>
  <verify>
    <automated>pnpm --filter worker test</automated>
  </verify>
  <done>Suíte do worker verde (≥175 testes), incluindo os casos novos.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| documentos da fase → commit | GAME.md/EVIDENCE.md versionados; não podem conter segredo |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-5-01 | Information Disclosure | segredo residual em GAME.md/EVIDENCE.md antes do commit | mitigate | grep de segredos no gate (Task 1 verify) + revisão manual antes de `git commit` |
</threat_model>

<verification>
- `pnpm --filter worker test` verde (≥175).
- `grep` de segredos em GAME.md/EVIDENCE.md não retorna match.
- Todo ponto de §9.1/§9.2 tem marca + data.
</verification>

<success_criteria>
- Success Criterion 5 do ROADMAP atingido: todo item de §9 marcado; cada divergência virou correção com teste; suíte verde.
- VAL-07 fechado.
</success_criteria>

<output>
Após concluir, criar `.planning/phases/phase-1-validacao-com-conta-real/5-SUMMARY.md`
(resumo do estado final de §9, contagem de testes e divergências corrigidas).
</output>

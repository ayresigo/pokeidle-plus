# EVIDENCE — Fase 1 (Validação com conta real)

Evidência sanitizada do smoke contra `poke.idleworld.online`. **Nunca** contém tokens,
senhas ou a chave do solver. Conta descartável (D-03); IP local sem proxy (D-04).

## VAL-01 — Aceite do captchaToken do solver (§9.1)

**Data:** 2026-10-12
**Caminho:** solver 2captcha (`TurnstileTaskProxyless`, IP do solver), `pnpm start` direto (D-05),
mais sondas `POST /api/auth/login` diretas (sem sessão WS) para isolar captcha vs credencial.

### Sondas diretas ao `POST /api/auth/login` (2026-10-12)
Mesma conta, IP local, variando só o `captchaToken`:

| Cenário | captchaToken | HTTP | message (backend) |
|---------|--------------|------|-------------------|
| Sem captcha | ausente | **400** | "Confirmação anti-robô ausente. Recarregue a página e tente de novo." |
| Captcha inválido | `garbage` | **400** | "Falha na verificação anti-robô. Tente novamente." |
| Captcha válido (worker, solver 2captcha) | token real | **401** | "Email ou senha incorretos." |

### Interpretação (decisiva)
O backend valida o anti-robô **antes** das credenciais: token ausente/ inválido → **400**
anti-robô; token válido → **passa** do anti-robô e cai na checagem de credencial (**401**).
O worker, usando o token do `TurnstileTaskProxyless` resolvido **no IP do 2captcha**, obteve
**401 (credencial)**, não 400 — ou seja, **o token do solver FOI ACEITO pelo anti-robô**. Não há
bind de `remoteip` que invalide o token por IP divergente.

### Vereditos VAL-01
- **Solver aceito pelo jogo? → CONFIRMADO.** O `captchaToken` do `TurnstileTaskProxyless`
  (IP do solver) é aceito por `POST /api/auth/login` (passou do anti-robô; prova: com token
  válido o erro é 401 credencial, com token inválido/ausente é 400 anti-robô). **Login automático
  via solver é viável.**
- **Backend exige captcha em todo login? → CONFIRMADO (sim).** Sem `captchaToken` → 400
  "Confirmação anti-robô ausente".
- **Turnstile usa action/cData?** NÃO — `turnstile.render(el, {sitekey, theme, callback, expired-callback})`
  no chunk `3aqjofv7-1o3x.js` (lido em 2026-10-12); só a sitekey. Sitekey `0x4AAAAAADkKBnFEMDt0MGBM`
  continua atual. Logo o `TurnstileTaskProxyless` (só sitekey+URL) gera token estruturalmente correto.

### Bloqueio atual: credencial, não captcha
Com o token do solver aceito, o login ainda retorna **401 "Email ou senha incorretos"** para
`ayresigo12@gmail.com` + a senha fornecida. Como o login manual "funciona no navegador", a
hipótese dominante é que a conta é **baseada em Google** (criada/entra por "Sign in with Google",
`/api/auth/google`) e **não tem senha nativa** para `/api/auth/login` — ou a senha nativa difere
da fornecida. O comportamento do worker é **correto**: cai em `needs-login` com `lastError` claro,
sem loop.

**Implicação para o projeto (login automático):** o worker consegue autenticar sozinho via
solver **desde que a conta tenha login nativo e-mail+senha** (contas só-Google não têm senha para
o endpoint nativo; automatizar o OAuth do Google está fora do escopo atual). Próximo passo:
validar com uma conta **criada com e-mail+senha** (ou com senha nativa definida).

**Guardas aplicadas:** nenhuma compra/venda; sem `cmid`; sondas de login não abrem sessão WS
(sem 4005); segredos só no `.env` local (ignorado pelo git); nenhum token/senha/chave neste arquivo.

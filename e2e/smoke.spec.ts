import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN, URL_CENTRAL, URL_FAKE_GAME, VERSAO_NOVA } from "./ambiente.ts";
import {
  CONTAINER_CONTROL_PLANE,
  containerExiste,
  docker,
  nomeDoWorker,
  registrarWorker,
  saudeDoContainer,
} from "./docker.ts";
import { ACCESS_TOKEN_VALIDO } from "./fake-game/token.ts";

const LABEL_CONTA = "conta-e2e";
const CHANGELOG = "Release de teste do E2E: nada muda de verdade.";

test.describe.configure({ mode: "serial" });

let page: Page;
let accountId = "";
let linha: Locator;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("login na UI leva ao dashboard", async () => {
  await page.goto("/login");
  await page.getByLabel("Usuário", { exact: true }).fill(ADMIN.username);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Contas" })).toBeVisible();
  await expect(page.getByText("nenhuma conta cadastrada")).toBeVisible();
});

test("cria conta pelo form colando o token do pokeidle.io", async () => {
  await page.getByRole("link", { name: "Nova conta" }).click();
  await expect(page.getByRole("heading", { name: "Nova conta" })).toBeVisible();
  await page.getByLabel("Nome da conta").fill(LABEL_CONTA);
  await page.getByLabel("Usuário PokeIdle").fill("treinador-e2e");
  await page.getByLabel("Senha PokeIdle").fill("senha-pokeidle-e2e");
  await page.getByLabel("Token do pokeidle.io").fill(ACCESS_TOKEN_VALIDO);
  await expect(page.getByText("token aplicado")).toBeVisible();
  await expect(page.getByLabel("accessToken")).toHaveValue(ACCESS_TOKEN_VALIDO);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL("/");
  linha = page.getByRole("row").filter({ hasText: LABEL_CONTA });
  await expect(linha).toBeVisible();
  const href = await linha.getByRole("link", { name: "Editar" }).getAttribute("href");
  accountId = href?.match(/^\/accounts\/([^/#?]+)$/)?.[1] ?? "";
  expect(accountId).not.toBe("");
  registrarWorker(accountId);
  await expect(linha.getByText("parado", { exact: true })).toBeVisible();
});

test("iniciar mostra jogando ao vivo e última ação", async () => {
  await linha.getByRole("button", { name: "Iniciar" }).click();
  await expect(linha.getByText("jogando", { exact: true })).toBeVisible();
  await expect(linha.getByRole("cell").nth(2)).toHaveText(/em hunt/);
  await expect(page.getByText("ao vivo", { exact: true })).toBeVisible();
  expect(containerExiste(nomeDoWorker(accountId))).toBe(true);
});

test("logs mostram linhas do worker", async () => {
  await linha.getByRole("button", { name: "Logs" }).click();
  const painel = page.getByRole("dialog", { name: `Logs de ${LABEL_CONTA}` });
  await expect(painel).toBeVisible();
  await expect(painel.getByText("ao vivo", { exact: true })).toBeVisible();
  await expect(painel).toContainText(`worker ${accountId}: autenticado via stored`);
  await painel.getByRole("button", { name: "Fechar" }).click();
  await expect(painel).toBeHidden();
});

test("kick do jogo (sessão revogada) leva a precisa de login com CTA de colar tokens", async () => {
  const resposta = await fetch(`${URL_FAKE_GAME}/__e2e/kick`, { method: "POST" });
  expect(resposta.ok).toBe(true);
  expect(await resposta.json()).toEqual({ fechados: 1 });
  await expect(linha.getByText("precisa de login", { exact: true })).toBeVisible();
  const cta = linha.getByRole("link", { name: "colar tokens" });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", `/accounts/${accountId}#tokens`);
});

test("parar mostra parado e remove o container do worker", async () => {
  await linha.getByRole("button", { name: "Parar" }).click();
  await expect(linha.getByText("parado", { exact: true })).toBeVisible();
  await expect(linha.getByRole("button", { name: "Iniciar" })).toBeVisible();
  await expect.poll(() => containerExiste(nomeDoWorker(accountId)), { timeout: 60_000 }).toBe(false);
});

test("release nova na central aparece como update disponível", async () => {
  const login = await fetch(`${URL_CENTRAL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  expect(login.status).toBe(200);
  const sessao: unknown = await login.json();
  const accessToken =
    typeof sessao === "object" && sessao !== null && "accessToken" in sessao && typeof sessao.accessToken === "string"
      ? sessao.accessToken
      : "";
  expect(accessToken).not.toBe("");
  const release = await fetch(`${URL_CENTRAL}/admin/releases`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      version: VERSAO_NOVA,
      channel: "stable",
      imageDigest: `sha256:${"e".repeat(64)}`,
      changelog: CHANGELOG,
    }),
  });
  expect(release.status).toBe(201);

  docker(["restart", CONTAINER_CONTROL_PLANE]);
  await expect.poll(() => saudeDoContainer(CONTAINER_CONTROL_PLANE), { timeout: 90_000 }).toBe("healthy");

  const badge = page.getByRole("banner").getByRole("link", { name: `v${VERSAO_NOVA} disponível` });
  await expect(async () => {
    await page.goto("/settings");
    await expect(badge).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: `Novidades da v${VERSAO_NOVA}` })).toBeVisible();
  await expect(page.getByText(CHANGELOG)).toBeVisible();
  await expect(page.getByText("v0.0.1-e2e", { exact: true })).toBeVisible();
});

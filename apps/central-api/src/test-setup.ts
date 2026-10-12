try {
  process.loadEnvFile(".env");
} catch {
}

const url = process.env.DATABASE_URL;
if (url) {
  const banco = new URL(url).pathname.replace(/^\//, "");
  if (!/_(dev|test)$/.test(banco)) {
    throw new Error(
      `os testes da central apagam todas as tabelas; DATABASE_URL precisa apontar para um banco *_dev ou *_test (atual: ${banco || "sem nome"})`,
    );
  }
}

export interface ResultadoSse {
  dados: string[];
  resto: string;
}

export function extrairDadosSse(buffer: string): ResultadoSse {
  const normalizado = buffer.replace(/\r\n?/g, "\n");
  const blocos = normalizado.split("\n\n");
  const resto = blocos.pop() ?? "";
  const dados: string[] = [];
  for (const bloco of blocos) {
    const linhas = bloco
      .split("\n")
      .filter((linha) => linha.startsWith("data:"))
      .map((linha) => linha.slice(5).replace(/^ /, ""));
    if (linhas.length > 0) dados.push(linhas.join("\n"));
  }
  return { dados, resto };
}

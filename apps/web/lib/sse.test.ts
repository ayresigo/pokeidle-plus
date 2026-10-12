import { describe, expect, it } from "vitest";
import { extrairDadosSse } from "./sse";

describe("extrairDadosSse", () => {
  it("extrai dados de eventos completos e ignora comentários", () => {
    const { dados, resto } = extrairDadosSse(': conectado\n\ndata: {"line":"a"}\n\ndata: {"line":"b"}\n\n');
    expect(dados).toEqual(['{"line":"a"}', '{"line":"b"}']);
    expect(resto).toBe("");
  });

  it("mantém evento incompleto no resto para o próximo chunk", () => {
    const primeiro = extrairDadosSse('data: {"line":"a"}\n\ndata: {"li');
    expect(primeiro).toEqual({ dados: ['{"line":"a"}'], resto: 'data: {"li' });

    const segundo = extrairDadosSse(`${primeiro.resto}ne":"b"}\n\n`);
    expect(segundo).toEqual({ dados: ['{"line":"b"}'], resto: "" });
  });

  it("junta várias linhas data do mesmo evento e aceita CRLF", () => {
    expect(extrairDadosSse("event: x\r\ndata: a\r\ndata: b\r\n\r\n").dados).toEqual(["a\nb"]);
  });
});

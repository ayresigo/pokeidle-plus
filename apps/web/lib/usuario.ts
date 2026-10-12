export const LIMITES_USUARIO = {
  usernameMin: 3,
  usernameMax: 64,
  senhaMin: 12,
  senhaMax: 256,
} as const;

const REGEX_USERNAME = /^[a-zA-Z0-9._-]+$/;

export const ALFABETO_SENHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_=+?";

export const TAMANHO_SENHA_GERADA = 20;

export interface ValoresNovoUsuario {
  username: string;
  password: string;
}

export type ErrosNovoUsuario = Partial<Record<keyof ValoresNovoUsuario, string>>;

export function validarUsername(username: string): string | null {
  if (username === "") return "obrigatório";
  if (username.length < LIMITES_USUARIO.usernameMin) return `mínimo de ${LIMITES_USUARIO.usernameMin} caracteres`;
  if (username.length > LIMITES_USUARIO.usernameMax) return `máximo de ${LIMITES_USUARIO.usernameMax} caracteres`;
  if (!REGEX_USERNAME.test(username)) return "use apenas letras sem acento, números, ponto, hífen ou sublinhado";
  return null;
}

export function validarSenha(senha: string): string | null {
  const tamanho = [...senha].length;
  if (tamanho === 0) return "obrigatório";
  if (tamanho < LIMITES_USUARIO.senhaMin) return `mínimo de ${LIMITES_USUARIO.senhaMin} caracteres`;
  if (tamanho > LIMITES_USUARIO.senhaMax) return `máximo de ${LIMITES_USUARIO.senhaMax} caracteres`;
  return null;
}

export function validarNovoUsuario(valores: ValoresNovoUsuario): ErrosNovoUsuario {
  const erros: ErrosNovoUsuario = {};
  const erroUsername = validarUsername(valores.username);
  if (erroUsername) erros.username = erroUsername;
  const erroSenha = validarSenha(valores.password);
  if (erroSenha) erros.password = erroSenha;
  return erros;
}

export function gerarSenhaForte(
  bytesAleatorios: (tamanho: number) => Uint8Array = (tamanho) => crypto.getRandomValues(new Uint8Array(tamanho)),
): string {
  const limiteSemVies = 256 - (256 % ALFABETO_SENHA.length);
  let senha = "";
  while (senha.length < TAMANHO_SENHA_GERADA) {
    for (const byte of bytesAleatorios(TAMANHO_SENHA_GERADA)) {
      if (byte >= limiteSemVies || senha.length === TAMANHO_SENHA_GERADA) continue;
      senha += ALFABETO_SENHA[byte % ALFABETO_SENHA.length];
    }
  }
  return senha;
}

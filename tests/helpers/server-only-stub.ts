// Substituto vazio de 'server-only' para os testes (Node puro, fora do react-server, onde o pacote lança erro).
// Ligado só em vitest.config.ts. O Next não usa este alias: a proteção de build continua ativa.
// A fronteira é verificada de forma estática em tests/architecture/client-boundary.test.ts.
export {};

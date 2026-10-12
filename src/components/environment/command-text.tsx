/*
 * Trechos técnicos das mensagens e dicas (comandos, variáveis FSLM_*, arquivos) viram <code>.
 * O texto vem do diagnóstico e é sempre renderizado como texto, nunca como HTML.
 */
const CODE_PATTERN =
  /(sudo dnf install [\w-]+(?: [\w-]+)*|pnpm (?:install|dev)|npm run dev|pnpm-lock\.yaml|node_modules|fslm\.db|FSLM_[A-Z_]+)(?![\w-])/;

export function CommandText({ text }: { text: string }) {
  // Com um único grupo de captura, os trechos casados caem nas posições ímpares.
  const parts = text.split(CODE_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={index}
            className="break-words rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em] text-foreground"
          >
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

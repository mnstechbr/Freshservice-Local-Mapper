#!/usr/bin/env bash
# =============================================================================
# scripts/setup.sh - preparação inicial do Freshservice-API no Fedora.
#
# Verifica Node.js >= 22.12 e npm. Se faltarem, instala pelo dnf (repositórios
# oficiais do Fedora) o par versionado nodejs24 + nodejs24-npm, ou nodejs22 +
# nodejs22-npm. Não instala pnpm: o bootstrap de `npm run dev` cuida disso.
#
# Uso: bash scripts/setup.sh [--check] [--yes] [--build-tools] [--help]
#   --check        só diagnostica; não altera o sistema
#   --yes          aceita as confirmações sem perguntar (automação); não inicia
#                  o servidor de desenvolvimento
#   --build-tools  oferece gcc-c++, make e python3 (opcional; só é necessário
#                  se o better-sqlite3 precisar compilar)
#
# Códigos de saída: 0 = pronto; 1 = pendência ou falha; 2 = uso inválido.
# =============================================================================
set -euo pipefail

readonly MIN_NODE_MAJOR=22
readonly MIN_NODE_MINOR=12
readonly NODE_URL="https://nodejs.org/en/download"
readonly FEDORA_DOC_URL="https://docs.fedoraproject.org/en-US/quick-docs/installing-software/"
# "pacote-node:pacote-npm" em ordem de preferência. No Fedora 44 não existe o
# pacote "nodejs" sem versão nem "npm" avulso: o npm vem no pacote -npm do par.
readonly NODE_PAIRS=("nodejs24:nodejs24-npm" "nodejs22:nodejs22-npm" "nodejs:npm")

CHECK_ONLY=0
ASSUME_YES=0
BUILD_TOOLS=0
IS_FEDORA=0
PRIV_PREFIX=""
NODE_VER=""
NPM_VER=""
CHOSEN_NODE=""
CHOSEN_NPM=""
DNF_FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info() { printf '[INFO]  %s\n' "$*"; }
ok()   { printf '[OK]    %s\n' "$*"; }
warn() { printf '[AVISO] %s\n' "$*"; }
# Tudo vai para stdout: com stdout e stderr no mesmo pipe, o buffer do bash trocaria a ordem das linhas.
err()  { printf '[ERRO]  %s\n' "$*"; }

usage() {
  cat <<'EOF'
Uso: bash scripts/setup.sh [opções]

  --check        Só diagnostica. Não instala nada.
  --yes          Aceita as confirmações sem perguntar (automação).
                 Não inicia o servidor de desenvolvimento.
  --build-tools  Oferece também gcc-c++, make e python3 (opcional).
  -h, --help     Mostra esta ajuda.
EOF
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --check) CHECK_ONLY=1 ;;
      --yes) ASSUME_YES=1 ;;
      --build-tools) BUILD_TOOLS=1 ;;
      -h|--help) usage; exit 0 ;;
      *) err "Opção desconhecida: $arg"; usage >&2; exit 2 ;;
    esac
  done
}

is_interactive() { [[ -t 0 ]]; }

# Pergunta [s/N]; o padrão é NÃO. Com --yes aceita sem perguntar.
confirm() {
  local resp=""
  if (( ASSUME_YES )); then
    info "Confirmado automaticamente (--yes)."
    return 0
  fi
  if ! is_interactive; then
    warn "Sem terminal interativo e sem --yes: confirmação negada por padrão."
    return 1
  fi
  read -r -p "$1 [s/N] " resp || true
  case "${resp,,}" in
    s|sim|y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

detect_versions() {
  NODE_VER=""
  NPM_VER=""
  if command -v node >/dev/null 2>&1; then NODE_VER="$(node -v 2>/dev/null || true)"; fi
  if command -v npm >/dev/null 2>&1; then NPM_VER="$(npm -v 2>/dev/null || true)"; fi
}

# Retorna 0 se a versão (ex.: v22.12.0) é >= 22.12, comparando major e minor.
is_node_ok() {
  [[ "$1" =~ ^v?([0-9]+)\.([0-9]+) ]] || return 1
  local maj=$((10#${BASH_REMATCH[1]})) min=$((10#${BASH_REMATCH[2]}))
  (( maj > MIN_NODE_MAJOR || (maj == MIN_NODE_MAJOR && min >= MIN_NODE_MINOR) ))
}

is_fedora() {
  local id="" like=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    id="$(. /etc/os-release && printf '%s' "${ID:-}")"
    # shellcheck source=/dev/null
    like="$(. /etc/os-release && printf '%s' "${ID_LIKE:-}")"
  fi
  [[ "$id" == fedora || " $like " == *" fedora "* ]]
}

has_network() { timeout 8 getent hosts registry.npmjs.org >/dev/null 2>&1; }

can_escalate() { (( EUID == 0 )) || command -v sudo >/dev/null 2>&1; }

# Imprime a versão mais nova do pacote nos repositórios (vazio se não existir).
# Retorna 1 se a própria consulta ao dnf falhar (ex.: usuário sem HOME gravável).
dnf_version() {
  local out
  command -v dnf >/dev/null 2>&1 || return 1
  out="$(dnf -q repoquery --latest-limit 1 --qf '%{version}\n' "$1" 2>/dev/null)" || return 1
  printf '%s\n' "$out" | sed -n '1p'
}

# Primeiro par cujo Node está no repositório, atende ao mínimo e tem npm.
# Define DNF_FAILED=1 se alguma consulta ao dnf falhar.
pick_fedora_pair() {
  local pair node_pkg npm_pkg ver npm_ver
  DNF_FAILED=0
  for pair in "${NODE_PAIRS[@]}"; do
    node_pkg="${pair%%:*}"
    npm_pkg="${pair##*:}"
    ver="$(dnf_version "$node_pkg")" || { DNF_FAILED=1; break; }
    npm_ver="$(dnf_version "$npm_pkg")" || { DNF_FAILED=1; break; }
    if [[ -n "$ver" && -n "$npm_ver" ]] && is_node_ok "$ver"; then
      CHOSEN_NODE="$node_pkg"
      CHOSEN_NPM="$npm_pkg"
      return 0
    fi
  done
  return 1
}

# Mensagem quando não há par utilizável; distingue falha de consulta de pacote ausente.
report_no_pair() {
  if (( DNF_FAILED )); then
    err "Não consegui consultar os repositórios do dnf."
    info "Como resolver: rode 'sudo dnf makecache' e tente de novo. Sem root, confira se seu diretório HOME é gravável. Docs: $FEDORA_DOC_URL"
  else
    err "Nenhum Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} com npm nos repositórios do Fedora."
    info "Como resolver: tente 'sudo dnf makecache' ou instale pelo site oficial: $NODE_URL"
  fi
}

# Pacote npm do Node já instalado via rpm (vazio se nenhum par estiver instalado).
installed_npm_pkg() {
  local pair
  for pair in "${NODE_PAIRS[@]}"; do
    if rpm -q --quiet "${pair%%:*}"; then
      printf '%s\n' "${pair##*:}"
      return 0
    fi
  done
  return 0
}

# Mostra o comando exato, pede confirmação e executa dnf install.
# Retorna 2 se o usuário não confirmar; senão, o código do dnf.
dnf_install() {
  local -a args=(install)
  local shown="${PRIV_PREFIX}dnf install"
  if (( ASSUME_YES )); then
    args+=(-y)
    shown+=" -y"
  fi
  args+=("$@")
  shown+=" $*"
  info "Comando: $shown"
  confirm "Confirma a instalação?" || return 2
  if (( EUID == 0 )); then
    dnf "${args[@]}"
  else
    sudo dnf "${args[@]}"
  fi
}

step_node_npm() {
  local -a pkgs=()
  local npm_pkg=""

  detect_versions
  if is_node_ok "$NODE_VER" && [[ -n "$NPM_VER" ]]; then
    ok "Node.js $NODE_VER e npm $NPM_VER atendem ao mínimo (Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR})."
    return 0
  fi
  if [[ -z "$NODE_VER" ]]; then
    info "Node.js não encontrado."
  elif ! is_node_ok "$NODE_VER"; then
    warn "Node.js $NODE_VER encontrado, mas o projeto exige >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}."
  fi
  if [[ -z "$NPM_VER" ]]; then info "npm não encontrado."; fi

  if (( ! IS_FEDORA )); then
    err "Sistema não é Fedora: este script não instala nada aqui."
    info "Como resolver: instale Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} e npm pelo site oficial ($NODE_URL) ou pelo gerenciador do seu sistema."
    return 1
  fi
  if ! has_network; then
    err "Sem acesso à rede (registry.npmjs.org não resolve). Nada foi alterado."
    info "Como resolver: verifique a conexão ou o proxy (http_proxy/https_proxy e /etc/dnf/dnf.conf) e rode de novo. Docs: $FEDORA_DOC_URL"
    return 1
  fi
  if (( ! CHECK_ONLY )) && ! can_escalate; then
    err "Não é root e o comando 'sudo' não existe: não é possível instalar pacotes. Nada foi alterado."
    info "Como resolver: rode como root (ex.: su -c \"bash $SCRIPT_DIR/setup.sh --yes\") ou peça ao administrador para instalar sudo. Docs: $FEDORA_DOC_URL"
    return 1
  fi

  if ! is_node_ok "$NODE_VER"; then
    if ! pick_fedora_pair; then
      report_no_pair
      return 1
    fi
    pkgs+=("$CHOSEN_NODE")
    if [[ -z "$NPM_VER" ]]; then pkgs+=("$CHOSEN_NPM"); fi
  else
    # Node presente, npm ausente: instala o npm do mesmo Node (ex.: nodejs24 sem nodejs24-npm).
    npm_pkg="$(installed_npm_pkg)"
    if [[ -z "$npm_pkg" || -z "$(dnf_version "$npm_pkg")" ]]; then
      if ! pick_fedora_pair; then
        report_no_pair
        return 1
      fi
      npm_pkg="$CHOSEN_NPM"
    fi
    pkgs+=("$npm_pkg")
  fi

  if (( CHECK_ONLY )); then
    info "Modo --check: pacotes que seriam instalados: ${pkgs[*]}"
    info "Comando previsto: ${PRIV_PREFIX}dnf install ${pkgs[*]}"
    return 1
  fi

  local rc=0
  dnf_install "${pkgs[@]}" || rc=$?
  if (( rc == 2 )); then
    err "Instalação não confirmada. Nada foi alterado."
    info "Para aceitar sem perguntas: bash \"$SCRIPT_DIR/setup.sh\" --yes"
    return 1
  fi
  if (( rc != 0 )); then
    err "A instalação via dnf falhou (código $rc). Veja a mensagem acima."
    info "Como resolver: rode 'sudo dnf makecache' e tente de novo. Docs: $FEDORA_DOC_URL"
    return 1
  fi

  hash -r
  detect_versions
  if is_node_ok "$NODE_VER" && [[ -n "$NPM_VER" ]]; then
    ok "Instalado: Node.js $NODE_VER e npm $NPM_VER."
    return 0
  fi
  err "Após a instalação: Node.js=${NODE_VER:-ausente}, npm=${NPM_VER:-ausente} (mínimo ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR})."
  info "Caminho atual do node: $(command -v node 2>/dev/null || echo ausente)"
  info "Como resolver: abra um novo terminal. Se houver outro Node no PATH (ex.: nvm), ative a versão >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}. Alternativa oficial: $NODE_URL"
  return 1
}

step_build_tools() {
  local -a missing=()
  local rc=0

  if (( ! BUILD_TOOLS )); then
    info "Ferramentas de compilação não solicitadas. Se o 'npm install' falhar ao compilar o better-sqlite3, rode com --build-tools."
    return 0
  fi
  command -v g++ >/dev/null 2>&1 || missing+=(gcc-c++)
  command -v make >/dev/null 2>&1 || missing+=(make)
  command -v python3 >/dev/null 2>&1 || missing+=(python3)
  if (( ${#missing[@]} == 0 )); then
    ok "Ferramentas de compilação já presentes (g++, make, python3)."
    return 0
  fi
  if (( CHECK_ONLY )); then
    info "Modo --check: ferramentas ausentes: ${missing[*]}. Comando previsto: ${PRIV_PREFIX}dnf install ${missing[*]}"
    return 0
  fi
  if (( ! IS_FEDORA )); then
    warn "Ferramentas ausentes (${missing[*]}). Instale-as pelo gerenciador do seu sistema."
    return 0
  fi
  if ! can_escalate; then
    warn "Sem sudo: instale manualmente ${missing[*]}. Docs: $FEDORA_DOC_URL"
    return 0
  fi
  dnf_install "${missing[@]}" || rc=$?
  if (( rc == 0 )); then
    ok "Ferramentas de compilação instaladas."
  elif (( rc == 2 )); then
    warn "Ferramentas de compilação não instaladas (sem confirmação)."
  else
    warn "Falha ao instalar ${missing[*]} (código $rc). Como resolver: 'sudo dnf makecache' e tente de novo. Docs: $FEDORA_DOC_URL"
  fi
  return 0
}

step_libsecret() {
  local rc=0

  if command -v secret-tool >/dev/null 2>&1; then
    ok "secret-tool presente (cofre do sistema, se o serviço de segredos estiver desbloqueado)."
  else
    info "secret-tool ausente. Ele é usado pelo cofre do sistema (Secret Service); é opcional."
    if (( CHECK_ONLY )); then
      info "Modo --check: comando previsto: ${PRIV_PREFIX}dnf install libsecret"
    elif (( IS_FEDORA )) && can_escalate; then
      dnf_install libsecret || rc=$?
      if (( rc == 0 )); then
        ok "libsecret instalado."
      elif (( rc == 2 )); then
        info "libsecret não instalado (sem confirmação)."
      else
        warn "Falha ao instalar libsecret (código $rc). Docs: $FEDORA_DOC_URL"
      fi
    fi
  fi
  info "Cofre: o Secret Service exige GNOME Keyring ou KWallet desbloqueado na sessão gráfica. Alternativa: defina FSLM_SECRET_KEY (README, seção 9)."
}

finish() {
  info "Próximo comando: cd \"$PROJECT_ROOT\" && npm run dev"
  if (( CHECK_ONLY || ASSUME_YES )) || ! is_interactive; then
    return 0
  fi
  if confirm "Iniciar agora o servidor de desenvolvimento (npm run dev)?"; then
    cd "$PROJECT_ROOT"
    exec npm run dev
  fi
  return 0
}

main() {
  local node_status=0

  parse_args "$@"
  if (( EUID != 0 )); then PRIV_PREFIX="sudo "; fi
  if is_fedora; then IS_FEDORA=1; fi
  info "Raiz do projeto: $PROJECT_ROOT"
  if (( CHECK_ONLY )); then info "Modo --check: somente diagnóstico, nada será instalado."; fi
  if (( IS_FEDORA )); then
    info "Fedora detectado."
  else
    warn "Este script foi feito para Fedora. Fora dele, só diagnostica."
  fi

  step_node_npm || node_status=$?
  if (( node_status != 0 )) && (( ! CHECK_ONLY )); then
    err "Node.js/npm continuam pendentes. Corrija o item acima e rode o script de novo."
    exit 1
  fi
  step_build_tools
  step_libsecret

  detect_versions
  info "Resumo: Node.js ${NODE_VER:-ausente}, npm ${NPM_VER:-ausente}."
  if (( node_status != 0 )); then
    err "Pendências de Node.js/npm (veja acima). Só houve diagnóstico."
    exit 1
  fi
  ok "Ambiente pronto para o projeto."
  finish
  exit 0
}

main "$@"

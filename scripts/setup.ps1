<#
.SYNOPSIS
    Preparação inicial do Freshservice-API no Windows 10/11.
.DESCRIPTION
    Verifica Node.js >= 22.12 e npm. Se faltarem, instala o Node.js LTS pelo winget
    (gerenciador oficial da Microsoft). Com -BuildTools, oferece as ferramentas C++
    do Visual Studio (só são necessárias se o better-sqlite3 precisar compilar).
    Não instala pnpm: o bootstrap de `npm run dev` cuida disso.
    Não altera a política de execução. Uso recomendado:
      powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
.PARAMETER Yes
    Aceita as confirmações sem perguntar (automação). Não inicia o servidor.
.PARAMETER CheckOnly
    Só diagnostica; não instala nada.
.PARAMETER BuildTools
    Também oferece o Visual Studio Build Tools (workload VCTools).
#>
param(
    [switch]$Yes,
    [switch]$CheckOnly,
    [switch]$BuildTools
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$NodeMinMajor = 22
$NodeMinMinor = 12
$NodeWingetId = 'OpenJS.NodeJS.LTS'
$BuildToolsWingetId = 'Microsoft.VisualStudio.2022.BuildTools'
$NodeUrl = 'https://nodejs.org/en/download'
$WingetDocUrl = 'https://learn.microsoft.com/windows/package-manager/winget/'
$AppInstallerUrl = 'https://apps.microsoft.com/detail/9NBLGGH4NNS1'
$BuildToolsUrl = 'https://visualstudio.microsoft.com/visual-cpp-build-tools/'

# $IsWindows só existe no PowerShell 6+; no Windows PowerShell 5.1 o sistema é sempre Windows.
$OnWindows = $true
if ($PSVersionTable.PSVersion.Major -ge 6) { $OnWindows = [bool]$IsWindows }
if (-not $OnWindows) {
    Write-Host '[ERRO]  Este script é para Windows 10/11. Neste sistema ele não faz nada.' -ForegroundColor Red
    Write-Host '        Como resolver: no Fedora use "bash scripts/setup.sh". Node.js: https://nodejs.org/en/download' -ForegroundColor Red
    exit 1
}

function Show-Info([string]$Message) { Write-Host "[INFO]  $Message" }
function Show-Ok([string]$Message) { Write-Host "[OK]    $Message" -ForegroundColor Green }
function Show-Warn([string]$Message) { Write-Host "[AVISO] $Message" -ForegroundColor Yellow }
function Show-Err([string]$Message) { Write-Host "[ERRO]  $Message" -ForegroundColor Red }

# Pergunta [s/N] (padrão NÃO). Com -Yes aceita; sem terminal interativo nega.
function Confirm-Action([string]$Question) {
    if ($Yes) {
        Show-Info 'Confirmado automaticamente (-Yes).'
        return $true
    }
    if ([Console]::IsInputRedirected) {
        Show-Warn 'Sem terminal interativo e sem -Yes: confirmação negada por padrão.'
        return $false
    }
    $answer = [string](Read-Host -Prompt "$Question [s/N]")
    return ($answer.Trim().ToLowerInvariant() -in @('s', 'sim', 'y', 'yes'))
}

# True se a versão (ex.: v22.12.0) é >= 22.12, comparando major e minor.
function Test-NodeVersion([string]$Version) {
    if ($Version -match '^v?(\d+)\.(\d+)') {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        return (($major -gt $NodeMinMajor) -or (($major -eq $NodeMinMajor) -and ($minor -ge $NodeMinMinor)))
    }
    return $false
}

# Versão de um comando instalado (ex.: 'node', 'npm.cmd'); vazio se não existir.
function Get-ToolVersion([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { return '' }
    try {
        $out = & $cmd.Source -v
        return ([string]$out).Trim()
    } catch {
        return ''
    }
}

# Recarrega o PATH da sessão a partir do Registro (útil logo após uma instalação).
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Test-Winget {
    return ($null -ne (Get-Command winget -ErrorAction SilentlyContinue))
}

# Verifica se registry.npmjs.org resolve (somente leitura).
function Test-NpmRegistry {
    try {
        Resolve-DnsName -Name 'registry.npmjs.org' -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

# True se o componente C++ do Visual Studio (VCTools) está instalado, via vswhere.
function Test-VcBuildTool {
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ([string]::IsNullOrEmpty($programFilesX86)) { return $false }
    $vswhere = [System.IO.Path]::Combine($programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    if (-not (Test-Path -LiteralPath $vswhere)) { return $false }
    try {
        $found = & $vswhere -latest -products '*' -requires 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' -property installationPath
        return (-not [string]::IsNullOrWhiteSpace([string]$found))
    } catch {
        return $false
    }
}

function Step-WindowsVersion {
    $build = [System.Environment]::OSVersion.Version.Build
    if ($build -ge 22000) {
        Show-Ok "Windows detectado (build $build); o número da build não distingue Windows cliente de Windows Server."
    } else {
        Show-Warn "Build $build (abaixo de 22000, Windows 11): não testado neste ambiente."
    }
}

# Garante Node.js >= 22.12 e npm. Retorna $true se o ambiente está pronto.
function Step-NodeNpm {
    $nodeVer = Get-ToolVersion 'node'
    $npmVer = Get-ToolVersion 'npm.cmd'
    if ((Test-NodeVersion $nodeVer) -and ($npmVer -ne '')) {
        Show-Ok "Node.js $nodeVer e npm $npmVer atendem ao mínimo (Node >= $NodeMinMajor.$NodeMinMinor)."
        return $true
    }
    if ($nodeVer -eq '') {
        Show-Info 'Node.js não encontrado.'
    } elseif (-not (Test-NodeVersion $nodeVer)) {
        Show-Warn "Node.js $nodeVer é antigo; o projeto exige >= $NodeMinMajor.$NodeMinMinor."
    }
    if ($npmVer -eq '') { Show-Info 'npm não encontrado.' }

    $verb = 'install'
    if ($nodeVer -ne '') { $verb = 'upgrade' }
    $command = "winget $verb --id $NodeWingetId --exact --source winget"

    if (-not (Test-Winget)) {
        Show-Err 'winget não encontrado. Nada foi alterado.'
        Show-Info "Como resolver: instale o App Installer (winget) pela Microsoft Store: $AppInstallerUrl . Docs: $WingetDocUrl"
        Show-Info "Ou instale o Node.js LTS pelo site oficial: $NodeUrl"
        return $false
    }
    if ($CheckOnly) {
        $net = 'NÃO resolve'
        if (Test-NpmRegistry) { $net = 'resolve' }
        Show-Info "Modo -CheckOnly: registry.npmjs.org $net. Comando previsto: $command"
        return $false
    }
    if (-not (Test-NpmRegistry)) {
        Show-Err 'Sem acesso à rede (registry.npmjs.org não resolve). Nada foi alterado.'
        Show-Info "Como resolver: verifique a conexão ou o proxy e rode de novo. Docs: $WingetDocUrl"
        return $false
    }

    Show-Info "Comando: $command (após sua confirmação, o winget aceita os termos do pacote)"
    Show-Warn 'O Windows pode pedir elevação (UAC). Confirme se a janela de UAC for esperada.'
    if (-not (Confirm-Action 'Instalar o Node.js LTS agora?')) {
        Show-Err 'Instalação não confirmada. Nada foi alterado.'
        Show-Info 'Para aceitar sem perguntas: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Yes'
        return $false
    }

    $wingetArgs = @($verb, '--id', $NodeWingetId, '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements')
    & winget @wingetArgs | Out-Host
    $code = $LASTEXITCODE
    Update-SessionPath
    $nodeVer = Get-ToolVersion 'node'
    $npmVer = Get-ToolVersion 'npm.cmd'
    if ((Test-NodeVersion $nodeVer) -and ($npmVer -ne '')) {
        Show-Ok "Instalado: Node.js $nodeVer e npm $npmVer."
        return $true
    }
    $nodeShown = 'ausente'
    if ($nodeVer -ne '') { $nodeShown = $nodeVer }
    $npmShown = 'ausente'
    if ($npmVer -ne '') { $npmShown = $npmVer }
    Show-Err "Após o winget (código $code): Node.js=$nodeShown, npm=$npmShown (mínimo $NodeMinMajor.$NodeMinMinor)."
    Show-Info 'Como resolver: feche e reabra o PowerShell (o PATH foi atualizado) e rode o script de novo.'
    Show-Info "Se persistir, instale pelo site oficial: $NodeUrl"
    return $false
}

# Ferramentas C++ do Visual Studio: opcional, só com -BuildTools.
function Step-BuildTool {
    if (-not $BuildTools) {
        Show-Info 'Ferramentas de compilação C++ não solicitadas. Se o npm install falhar ao compilar o better-sqlite3, rode com -BuildTools.'
        return
    }
    if (Test-VcBuildTool) {
        Show-Ok 'Ferramentas de compilação C++ (VCTools) já presentes.'
        return
    }
    $command = 'winget install --id ' + $BuildToolsWingetId + ' --exact --source winget --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
    Show-Info "Comando: $command"
    Show-Warn 'Download grande (vários GB) e demorado; exige elevação (UAC).'
    if ($CheckOnly) {
        Show-Info 'Modo -CheckOnly: ferramentas ausentes; nada foi instalado.'
        return
    }
    if (-not (Test-Winget)) {
        Show-Warn "winget ausente. Como resolver: instale o Visual Studio Build Tools pelo site oficial: $BuildToolsUrl"
        return
    }
    if (-not (Confirm-Action 'Instalar as ferramentas de compilação C++ agora?')) {
        Show-Warn 'Ferramentas não instaladas (sem confirmação).'
        return
    }

    $wingetArgs = @('install', '--id', $BuildToolsWingetId, '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--override', '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
    & winget @wingetArgs | Out-Host
    $code = $LASTEXITCODE
    if (($code -eq 0) -and (Test-VcBuildTool)) {
        Show-Ok 'Ferramentas de compilação C++ instaladas.'
    } else {
        Show-Warn "Não confirmei a instalação das ferramentas C++ (código $code). Como resolver: verifique no Visual Studio Installer ou em $BuildToolsUrl"
    }
}

# Cofre do Windows: DPAPI via powershell.exe. Nada a instalar.
function Step-Vault {
    if ($env:SystemRoot -match '^[A-Za-z]:[\\/]' -and (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -PathType Leaf)) {
        Show-Ok 'powershell.exe disponível: o cofre usa DPAPI do Windows. Nada a instalar.'
    } else {
        Show-Warn 'PowerShell do sistema não encontrado: o cofre (DPAPI) pode falhar. Como resolver: confira SystemRoot e o Windows PowerShell em %SystemRoot%\System32\WindowsPowerShell\v1.0\.'
    }
}

function Invoke-Main {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    Show-Info "Raiz do projeto: $projectRoot"
    if ($CheckOnly) { Show-Info 'Modo -CheckOnly: somente diagnóstico, nada será instalado.' }

    Step-WindowsVersion
    $nodeReady = Step-NodeNpm
    Step-BuildTool
    Step-Vault

    $nodeVer = Get-ToolVersion 'node'
    $npmVer = Get-ToolVersion 'npm.cmd'
    $nodeShown = 'ausente'
    if ($nodeVer -ne '') { $nodeShown = $nodeVer }
    $npmShown = 'ausente'
    if ($npmVer -ne '') { $npmShown = $npmVer }
    Show-Info "Resumo: Node.js $nodeShown, npm $npmShown."

    if (-not $nodeReady) {
        Show-Err 'Pendências de Node.js/npm (veja acima).'
        exit 1
    }
    Show-Ok 'Ambiente pronto para o projeto.'
    Show-Info ('Próximo comando: cd "' + $projectRoot + '"; npm run dev')
    if ($CheckOnly -or $Yes -or [Console]::IsInputRedirected) { exit 0 }

    if (Confirm-Action 'Iniciar agora o servidor de desenvolvimento (npm run dev)?') {
        Set-Location -LiteralPath $projectRoot
        & npm.cmd run dev
        exit $LASTEXITCODE
    }
    exit 0
}

try {
    Invoke-Main
} catch {
    Show-Err "Falha inesperada: $($_.Exception.Message)"
    Show-Info "Como resolver: rode de novo com -CheckOnly para diagnosticar. Docs: $WingetDocUrl"
    exit 1
}

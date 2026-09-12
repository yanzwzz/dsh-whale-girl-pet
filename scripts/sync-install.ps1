# ============================================================================
# 同步到已安装副本（开发用）—— 防止"改了工作区但忘了同步，重启后还是旧代码"
# ============================================================================
#
# 【为什么需要】
#   DSH 的 web profile 里装的是本插件的**副本**
#   （~/.dsh/profiles/node_modules/dsh-whale-girl-pet），不是软链。
#   而且插件 bundle 在 dsh web 启动时就被载入内存。所以每次改完代码必须：
#       1) 跑本脚本同步 → 2) 重启 dsh web → 3) 刷新页面
#   漏掉第 1 步时，"重启后现象没变"会非常难查（像是修改没生效，实际是文件没过去）。
#
# 【用法】
#   pwsh -File scripts/sync-install.ps1            # 同步并校验
#   pwsh -File scripts/sync-install.ps1 -CheckOnly # 只校验，不改动
# ============================================================================
[CmdletBinding()]
param(
    [string]$Source = (Split-Path -Parent $PSScriptRoot),
    [string]$Target = (Join-Path $HOME '.dsh\profiles\node_modules\dsh-whale-girl-pet'),
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

# 需要同步的清单：lib 下的全部实现 + 文档 + 包清单 + patch
$files = @(
    'lib\index.js',
    'lib\client.js',
    'lib\usage.js',
    'lib\usage-ledger.js',
    'lib\cost-projection.js',
    'lib\types\index.d.ts',
    'lib\types\client\index.d.ts',
    'cordis.patch.yml',
    'package.json',
    'README.md',
    'README.en.md'
)

# 资源目录（动画）体积大，只在缺失时同步，避免每次无谓复制 26MB
$assetDirs = @('assets\thumb', 'assets\preview')

if (-not (Test-Path $Target)) {
    Write-Error "找不到已安装副本：$Target`n（先用 dsh plugin --profile web add <路径> 安装本插件）"
}

Write-Host "源   : $Source"
Write-Host "目标 : $Target"
Write-Host ""

$copied = 0
$sameCount = 0
$missing = @()

foreach ($relative in $files) {
    $from = Join-Path $Source $relative
    $to = Join-Path $Target $relative
    if (-not (Test-Path $from)) { $missing += $relative; continue }

    $identical = (Test-Path $to) -and ((Get-FileHash $from).Hash -eq (Get-FileHash $to).Hash)
    if ($identical) {
        $sameCount++
        Write-Host ("  = " + $relative)
        continue
    }

    if ($CheckOnly) {
        Write-Host ("  ! " + $relative + "  需要同步") -ForegroundColor Yellow
        $copied++
        continue
    }

    $parent = Split-Path -Parent $to
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Copy-Item $from $to -Force
    $copied++
    Write-Host ("  → " + $relative) -ForegroundColor Cyan
}

foreach ($dir in $assetDirs) {
    $from = Join-Path $Source $dir
    $to = Join-Path $Target $dir
    if (-not (Test-Path $from)) { continue }
    if (-not (Test-Path $to)) {
        if ($CheckOnly) {
            Write-Host ("  ! " + $dir + "  缺少资源目录") -ForegroundColor Yellow
            $copied++
        } else {
            Copy-Item $from $to -Recurse -Force
            Write-Host ("  → " + $dir + " (整目录)") -ForegroundColor Cyan
            $copied++
        }
    } else {
        Write-Host ("  = " + $dir + " (已存在)")
    }
}

Write-Host ""
if ($missing.Count -gt 0) {
    Write-Host ("源里缺少这些文件（已跳过）：" + ($missing -join ', ')) -ForegroundColor Yellow
}

if ($CheckOnly) {
    if ($copied -eq 0) {
        Write-Host "✔ 已安装副本与工作区一致，无需同步" -ForegroundColor Green
    } else {
        Write-Host ("✖ 有 " + $copied + " 项需要同步（去掉 -CheckOnly 执行）") -ForegroundColor Yellow
        exit 1
    }
} else {
    # 记录本次同步时刻：判断"进程是否加载了当前代码"要跟它比，
    # 不能比文件 mtime——复制会保留源文件 mtime，那个时间比同步动作本身早。
    $marker = Join-Path $Target '.last-sync'
    (Get-Date).ToString('o') | Set-Content $marker -NoNewline
    Write-Host ("✔ 同步完成：更新 " + $copied + " 项，已一致 " + $sameCount + " 项") -ForegroundColor Green
}

# 提示进程是否需要重启：插件 bundle 在 dsh web 启动时载入内存
$listener = Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process) {
        $marker = Join-Path $Target '.last-sync'
        $syncedAt = if (Test-Path $marker) { [datetime]::Parse((Get-Content $marker -Raw)) } else { $null }
        Write-Host ""
        if ($null -eq $syncedAt) {
            Write-Host ("⚠ 没有同步记录，无法判断；若改动过 lib/ 请重启 dsh web (PID " + $process.Id + ")") -ForegroundColor Yellow
        } elseif ($syncedAt -gt $process.StartTime) {
            Write-Host ("⚠ dsh web (PID " + $process.Id + "，启动于 " + $process.StartTime.ToString('HH:mm:ss') + ") 早于本次同步（" + $syncedAt.ToString('HH:mm:ss') + "），必须重启才会加载新代码") -ForegroundColor Yellow
        } else {
            Write-Host ("✔ dsh web (PID " + $process.Id + "，启动于 " + $process.StartTime.ToString('HH:mm:ss') + ") 已加载当前代码（最后同步 " + $syncedAt.ToString('HH:mm:ss') + "）") -ForegroundColor Green
        }
    }
}

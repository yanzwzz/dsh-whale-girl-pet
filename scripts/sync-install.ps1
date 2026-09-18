# ============================================================================
# 同步到已安装副本（开发用）—— 防止"改了工作区但忘了同步，重启后还是旧代码"
# ============================================================================
#
# 【为什么需要】
#   DSH 的 web profile 里装的是本插件的**副本**，不是软链。而且插件 bundle 在
#   dsh web 启动时就被载入内存，并按 URL 记住编译结果（dsh-client-modules 的
#   lazyBody 只读一次磁盘），所以每次改完代码必须：
#       1) 跑本脚本同步 → 2) 重启 dsh web → 3) 刷新页面
#
#   ⚠ 同一台机器上可能同时存在**不止一份**副本（2026-09-18 踩过）：
#       ~/.dsh/profiles/web/node_modules/dsh-whale-girl-pet   ← web profile 真正加载的那份
#       ~/.dsh/profiles/node_modules/dsh-whale-girl-pet       ← 根级副本（早期默认目标）
#   只同步其中一份，就会出现"重启了但现象没变"的假象。所以本脚本默认**同步全部
#   已存在的副本**，并在最后逐字节校验；-Target 可显式指定一份或多份。
#
# 【用法】
#   pwsh -File scripts/sync-install.ps1                 # 同步全部副本并校验
#   pwsh -File scripts/sync-install.ps1 -CheckOnly      # 只校验，不改动
#   pwsh -File scripts/sync-install.ps1 -Target <路径>   # 只同步指定副本（可多个）
# ============================================================================
[CmdletBinding()]
param(
    [string]$Source = (Split-Path -Parent $PSScriptRoot),
    [string[]]$Target,
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

# ---------- 解析目标副本 ----------
if (-not $Target -or $Target.Count -eq 0) {
    $profilesRoot = Join-Path $HOME '.dsh\profiles'
    $candidates = @()
    if (Test-Path $profilesRoot) {
        # 根级副本：~/.dsh/profiles/node_modules/<pkg>
        $candidates += Join-Path $profilesRoot 'node_modules\dsh-whale-girl-pet'
        # 各 profile 内副本：~/.dsh/profiles/<profile>/node_modules/<pkg>
        $candidates += @(Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'node_modules\dsh-whale-girl-pet' })
    }
    $Target = @($candidates | Where-Object { Test-Path $_ } | Select-Object -Unique)
}

if (-not $Target -or $Target.Count -eq 0) {
    Write-Error "找不到任何已安装副本（默认查找 ~/.dsh/profiles[*]/node_modules/dsh-whale-girl-pet）`n（先用 dsh plugin --profile web add <路径> 安装本插件，或用 -Target 指定路径）"
    exit 1
}

Write-Host "源   : $Source"
Write-Host "目标 :"
foreach ($one in $Target) { Write-Host ("       " + $one) }
Write-Host ""

$totalCopied = 0
$totalSame = 0
$needsSync = $false

foreach ($copy in $Target) {
    Write-Host ("===== " + $copy) -ForegroundColor Cyan
    $copied = 0
    $sameCount = 0
    $missing = @()

    foreach ($relative in $files) {
        $from = Join-Path $Source $relative
        $to = Join-Path $copy $relative
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
        $to = Join-Path $copy $dir
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

    if ($missing.Count -gt 0) {
        Write-Host ("  源里缺少这些文件（已跳过）：" + ($missing -join ', ')) -ForegroundColor Yellow
    }

    if ($CheckOnly) {
        if ($copied -eq 0) {
            Write-Host "  ✔ 与工作区一致" -ForegroundColor Green
        } else {
            Write-Host ("  ✖ 有 " + $copied + " 项需要同步（去掉 -CheckOnly 执行）") -ForegroundColor Yellow
            $needsSync = $true
        }
    } else {
        # 记录本次同步时刻：判断"进程是否加载了当前代码"要跟它比，
        # 不能比文件 mtime——复制会保留源文件 mtime，那个时间比同步动作本身早。
        $marker = Join-Path $copy '.last-sync'
        (Get-Date).ToString('o') | Set-Content $marker -NoNewline
        Write-Host ("  ✔ 更新 " + $copied + " 项，已一致 " + $sameCount + " 项") -ForegroundColor Green
    }

    $totalCopied += $copied
    $totalSame += $sameCount
    Write-Host ""
}

if ($CheckOnly) {
    if ($needsSync) { exit 1 }
    Write-Host ("✔ 全部副本（" + $Target.Count + " 份）与工作区一致，无需同步") -ForegroundColor Green
    exit 0
}

# ---------- 收尾校验：每份副本都要逐字节一致 ----------
$drift = @()
foreach ($copy in $Target) {
    foreach ($relative in $files) {
        $from = Join-Path $Source $relative
        $to = Join-Path $copy $relative
        if (-not (Test-Path $from)) { continue }
        if (-not (Test-Path $to) -or ((Get-FileHash $from).Hash -ne (Get-FileHash $to).Hash)) {
            $drift += ($copy + ' :: ' + $relative)
        }
    }
}
if ($drift.Count -gt 0) {
    Write-Host "✖ 收尾校验失败，以下副本仍与工作区不一致：" -ForegroundColor Red
    foreach ($item in $drift) { Write-Host ("   " + $item) -ForegroundColor Red }
    exit 1
}

Write-Host ("✔ 同步完成：更新 " + $totalCopied + " 项，已一致 " + $totalSame + " 项，共 " + $Target.Count + " 份副本全部逐字节一致") -ForegroundColor Green

# ---------- 提示进程是否需要重启 ----------
# 插件 bundle 在 dsh web 启动时载入内存，且按 URL 记忆（lazyBody），只刷新页面不生效。
Write-Host ""
Write-Host "提醒：web profile 实际加载的是 profile 内那份副本（...\profiles\<profile>\node_modules\dsh-whale-girl-pet）。" -ForegroundColor DarkGray
$listener = Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process) {
        $syncedAt = $null
        foreach ($copy in $Target) {
            $marker = Join-Path $copy '.last-sync'
            if (Test-Path $marker) {
                $stamp = [datetime]::Parse((Get-Content $marker -Raw))
                if ($null -eq $syncedAt -or $stamp -gt $syncedAt) { $syncedAt = $stamp }
            }
        }
        if ($null -eq $syncedAt) {
            Write-Host ("⚠ 没有同步记录，无法判断；若改动过 lib/ 请重启 dsh web (PID " + $process.Id + ")") -ForegroundColor Yellow
        } elseif ($syncedAt -gt $process.StartTime) {
            Write-Host ("⚠ dsh web (PID " + $process.Id + "，启动于 " + $process.StartTime.ToString('HH:mm:ss') + ") 早于本次同步（" + $syncedAt.ToString('HH:mm:ss') + "），必须重启才会加载新代码") -ForegroundColor Yellow
        } else {
            Write-Host ("✔ dsh web (PID " + $process.Id + "，启动于 " + $process.StartTime.ToString('HH:mm:ss') + ") 已加载当前代码（最后同步 " + $syncedAt.ToString('HH:mm:ss') + "）") -ForegroundColor Green
        }
    }
}

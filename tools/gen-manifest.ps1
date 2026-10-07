# 生成 res\illustration 曲绘清单：
#   manifest.json  —— 数据交换 / 后续自动匹配使用
#   manifest.js    —— window.ILLUSTRATION_MANIFEST，供 index.html 在 file:// 下也能加载
# 用法：pwsh -File tools\gen-manifest.ps1   （新增 / 删除 / 重命名曲绘后重新运行）
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dir  = Join-Path $root 'res\illustration'
if (-not (Test-Path -LiteralPath $dir)) { throw "目录不存在: $dir" }

$entries = foreach ($f in (Get-ChildItem -LiteralPath $dir -File -Filter '*.png' | Sort-Object Name)) {
    $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)
    $kind = 'Other'
    if ($base -match '^\((?<k>Artwork|SquareArtwork|Special)\)') {
        $kind = $Matches['k']
        $base = $base.Substring($Matches[0].Length)
    }
    elseif ($base -match '^\([^)]*\)') {
        $base = $base.Substring($Matches[0].Length)
    }
    $base = $base.Trim()
    # 与 index.html 的 extractSongName 一致：取最后一个 ' - ' 之前的部分作为曲名
    $name = $base
    $idx  = $name.LastIndexOf(' - ')
    if ($idx -gt 0) { $name = $name.Substring(0, $idx).Trim() }

    [pscustomobject][ordered]@{
        file = $f.Name
        name = $name
        kind = $kind
    }
}
$entries = @($entries)

$json = ConvertTo-Json -InputObject $entries -Depth 3
$js   = 'window.ILLUSTRATION_MANIFEST = ' + (ConvertTo-Json -InputObject $entries -Depth 3 -Compress) + ';'

[IO.File]::WriteAllText((Join-Path $dir 'manifest.json'), $json + "`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $dir 'manifest.js'),   $js   + "`n", [Text.UTF8Encoding]::new($false))

"manifest: $($entries.Count) 条 -> res\illustration\manifest.{json,js}"
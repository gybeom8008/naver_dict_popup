<#
  설치용 파일을 만든다.

      pwsh -File build.ps1

  dist\naver-dict-popup-<버전>.xpi 가 생긴다. (.xpi 는 확장자만 다른 zip 이다.)
  크롬은 이 파일이 필요 없다. 저장소 폴더를 '압축해제된 확장 프로그램 로드'로 바로 읽는다.
  references\ 처럼 확장기능에 필요 없는 것은 넣지 않는다.
#>

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

# 패키지에 넣을 것만 고른다
$items = @(
  'manifest.json',
  'background.js',
  'background-chrome.js',
  'common',
  'content',
  'icons',
  'options',
  'popup'
)

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("nvd-build-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

try {
  foreach ($item in $items) {
    $source = Join-Path $root $item
    if (-not (Test-Path $source)) { throw "빠진 파일: $item" }
    Copy-Item -Path $source -Destination $stage -Recurse -Force
  }

  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory -Path $dist -Force | Out-Null

  $xpi = Join-Path $dist "naver-dict-popup-$version.xpi"
  if (Test-Path $xpi) { Remove-Item $xpi -Force }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $xpi, [System.IO.Compression.CompressionLevel]::Optimal, $false)

  $size = [math]::Round((Get-Item $xpi).Length / 1KB, 1)
  Write-Output "만들어짐: $xpi ($size KB)"

  # 압축 파일 안의 목록을 보여 준다 (manifest.json 이 최상단에 있어야 한다)
  $zip = [System.IO.Compression.ZipFile]::OpenRead($xpi)
  try {
    $zip.Entries | Sort-Object FullName | ForEach-Object {
      Write-Output ("  {0,7}  {1}" -f $_.Length, $_.FullName)
    }
  } finally {
    $zip.Dispose()
  }
}
finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

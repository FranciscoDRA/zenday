# Backup automático diario del repo. Registrado como tarea programada de
# Windows ("ZenDay - Backup diario"). Si no hay cambios, no hace nada (no
# genera commits vacíos).
#
# OJO: no usar 2>&1 sobre los comandos git de abajo. En PowerShell 5.1 eso
# convierte cualquier línea de stderr (hasta un aviso inofensivo tipo
# "LF will be replaced by CRLF") en un error, aunque git haya salido con
# código 0. Se chequea $LASTEXITCODE en su lugar.

$repo = 'C:\Users\franc\mi-calendario'
$logFile = Join-Path $repo 'scripts\backup-diario.log'

function Log($msg) {
    $linea = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $logFile -Value $linea -Encoding utf8
}

try {
    Set-Location $repo

    git add -A | Out-Null

    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Log 'Sin cambios pendientes. No se commitea.'
        exit 0
    }

    $fecha = Get-Date -Format 'yyyy-MM-dd HH:mm'
    git commit -m "Backup automatico $fecha" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "ERROR: git commit devolvió código $LASTEXITCODE"
        exit 1
    }

    git push origin master | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log "ERROR: git push devolvió código $LASTEXITCODE (el commit local sí se hizo)."
        exit 1
    }

    Log "Backup OK: $fecha"
} catch {
    Log "ERROR inesperado: $($_.Exception.Message)"
    exit 1
}

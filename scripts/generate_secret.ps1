# Finance Flow AI - Cryptographically Secure SECRET_KEY Generator
# Generates a 64-character (32-byte) random hex key using .NET RandomNumberGenerator

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$hexSecret = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLower()

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "     Finance Flow AI - Production SECRET_KEY Generator" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "Generated Secret Key (64-character hex, 256-bit entropy):"
Write-Host ""
Write-Host "  $hexSecret" -ForegroundColor Green
Write-Host ""
Write-Host "Copy this value and set it as SECRET_KEY in your Render Web Service."
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

try {
    Set-Clipboard -Value $hexSecret
    Write-Host "[i] Copied to clipboard automatically!" -ForegroundColor Yellow
} catch {
    # Headless fallback
}

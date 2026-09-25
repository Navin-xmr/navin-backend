$bytes = [IO.File]::ReadAllBytes('docs/swagger.yaml')
for ($i = 0; $i -lt $bytes.Length; $i++) {
  if ($bytes[$i] -gt 127) {
    "Byte $i = $($bytes[$i]) char = $([char]$bytes[$i]) context = $([System.Text.Encoding]::UTF8.GetString($bytes, [Math]::Max(0,$i-20), 50))"
  }
}
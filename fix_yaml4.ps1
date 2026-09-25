$bytes = [IO.File]::ReadAllBytes('docs/swagger.yaml')
for ($i = 15000; $i -lt 15500; $i++) {
  if ($bytes[$i] -gt 127) {
    "Byte $i = $($bytes[$i]) char = $([char]$bytes[$i])"
  }
}
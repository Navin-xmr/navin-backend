$c = Get-Content docs/swagger.yaml -Raw
$c = $c -replace 'A�A�A��\?sA�A��,�A\?', '—'
[IO.File]::WriteAllText('docs/swagger.yaml', $c)
'Done'
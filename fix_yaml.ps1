$c = Get-Content docs/swagger.yaml -Raw
$old = "`$ref: '#/components/schemas/ErrorResponse'`r`n      nextCursor:`r`n        type: string`r`n  /api/company/invitations/{id}/resend:"
$new = "`$ref: '#/components/schemas/ErrorResponse'`r`n  /api/company/invitations/{id}/resend:"
$fixed = $c -replace [regex]::Escape($old), $new
[IO.File]::WriteAllText('docs/swagger.yaml', $fixed)
'Done'
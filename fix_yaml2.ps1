$c = Get-Content docs/swagger.yaml -Raw
$search = "nextCursor:`r`n                        type: string`r`n  /api/company/invitations/{id}/resend:"
$idx = $c.IndexOf($search)
if ($idx -ge 0) {
  $before = $c.Substring(0, $idx)
  $after = $c.Substring($idx + $search.Length)
  $fixed = $before + "  /api/company/invitations/{id}/resend:" + $after
  [IO.File]::WriteAllText('docs/swagger.yaml', $fixed)
  "Fixed!"
} else {
  "Not found"
}
<#
  Too Funny Productions — PostgreSQL Backup/Restore helper
  * GUI prompts for connection info and pg_bin path; settings cached in TFP-DB-BackupRestore.config.json
  * Backup: runs pg_dump -Fc to a chosen .backup path
  * Restore: runs pg_restore --clean --no-owner --no-privileges -1 for .backup/.dump/.bak, or psql -f for .sql
#>

[CmdletBinding()]
param()

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$configPath = Join-Path $scriptDir 'TFP-DB-BackupRestore.config.json'

function Get-DefaultConfig {
  return [ordered]@{
    Host       = '127.0.0.1'
    Port       = '5432'
    Database   = 'toofunny'
    User       = 'postgres'
    Password   = ''
    PgBinPath  = 'C:\\Program Files\\PostgreSQL\\18\\bin'
    LastBackup = ''
  }
}

function Load-Config {
  if (Test-Path $configPath) {
    try {
      return (Get-Content $configPath -Raw | ConvertFrom-Json)
    } catch {
      Write-Warning "Could not parse existing config; using defaults. $_"
    }
  }
  return Get-DefaultConfig
}

function Save-Config($config) {
  $config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
}

function Prompt-ForValue($label, $default, [switch]$AsPassword) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $label
  $form.Width = 420
  $form.Height = 140
  $form.StartPosition = 'CenterScreen'

  $labelControl = New-Object System.Windows.Forms.Label
  $labelControl.Text = $label
  $labelControl.Left = 10
  $labelControl.Top = 10
  $labelControl.Width = 380
  $form.Controls.Add($labelControl)

  if ($AsPassword) {
    $textbox = New-Object System.Windows.Forms.MaskedTextBox
    $textbox.UseSystemPasswordChar = $true
  } else {
    $textbox = New-Object System.Windows.Forms.TextBox
  }
  $textbox.Left = 10
  $textbox.Top = 35
  $textbox.Width = 380
  $textbox.Text = $default
  $form.Controls.Add($textbox)

  $okButton = New-Object System.Windows.Forms.Button
  $okButton.Text = 'OK'
  $okButton.Width = 80
  $okButton.Height = 25
  $okButton.Left = 150
  $okButton.Top = 70
  $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.AcceptButton = $okButton
  $form.Controls.Add($okButton)

  $result = $form.ShowDialog()
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    return $textbox.Text
  }
  throw "Cancelled"
}

function Prompt-Connection($config) {
  try {
    $config.Host = Prompt-ForValue 'Host' $config.Host
    $config.Port = Prompt-ForValue 'Port' $config.Port
    $config.Database = Prompt-ForValue 'Database' $config.Database
    $config.User = Prompt-ForValue 'User' $config.User
    $config.Password = Prompt-ForValue 'Password' $config.Password -AsPassword
    $config.PgBinPath = Prompt-ForValue 'Path to PostgreSQL bin (pg_dump/pg_restore/psql)' $config.PgBinPath
    return $config
  } catch {
    throw
  }
}

function Select-BackupPath($defaultPath) {
  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Filter = 'Custom backup (*.backup)|*.backup|All files (*.*)|*.*'
  if ($defaultPath) { $dialog.FileName = $defaultPath }
  $dialog.Title = 'Choose backup destination'
  $result = $dialog.ShowDialog()
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
  throw "Cancelled"
}

function Select-RestoreFile() {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Filter = 'Backups (*.backup;*.bak;*.dump;*.sql)|*.backup;*.bak;*.dump;*.sql|All files (*.*)|*.*'
  $dialog.Title = 'Select backup to restore'
  $result = $dialog.ShowDialog()
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
  throw "Cancelled"
}

function Invoke-DbCommand($exePath, $arguments, $password) {
  if (!(Test-Path $exePath)) { throw "Executable not found: $exePath" }
  $previousPwd = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $password
    Write-Host "Running: $exePath $arguments" -ForegroundColor Cyan
    $process = Start-Process -FilePath $exePath -ArgumentList $arguments -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -ne 0) {
      throw "Command failed with exit code $($process.ExitCode)"
    }
  } finally {
    if ($null -ne $previousPwd) { $env:PGPASSWORD = $previousPwd } else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  }
}

function Backup-Database($config) {
  $path = Select-BackupPath $config.LastBackup
  $pgDump = Join-Path $config.PgBinPath 'pg_dump.exe'
  $args = @(
    '-h', $config.Host,
    '-p', $config.Port,
    '-U', $config.User,
    '-d', $config.Database,
    '-Fc',
    '-f', "\"$path\""
  ) -join ' '
  Invoke-DbCommand -exePath $pgDump -arguments $args -password $config.Password
  $config.LastBackup = $path
  Save-Config $config
  [System.Windows.Forms.MessageBox]::Show("Backup complete: $path", 'Success', 'OK', 'Information') | Out-Null
}

function Restore-Database($config) {
  $file = Select-RestoreFile
  if (!(Test-Path $file)) { throw "File not found: $file" }

  $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
  if ($ext -eq '.sql') {
    $exe = Join-Path $config.PgBinPath 'psql.exe'
    $args = @(
      '-h', $config.Host,
      '-p', $config.Port,
      '-U', $config.User,
      '-d', $config.Database,
      '-f', "\"$file\""
    ) -join ' '
    Invoke-DbCommand -exePath $exe -arguments $args -password $config.Password
  } else {
    $exe = Join-Path $config.PgBinPath 'pg_restore.exe'
    $args = @(
      '--clean', '--no-owner', '--no-privileges', '-1',
      '-h', $config.Host,
      '-p', $config.Port,
      '-U', $config.User,
      '-d', $config.Database,
      "\"$file\""
    ) -join ' '
    Invoke-DbCommand -exePath $exe -arguments $args -password $config.Password
  }
  Save-Config $config
  [System.Windows.Forms.MessageBox]::Show("Restore complete from: $file", 'Success', 'OK', 'Information') | Out-Null
}

function Show-MainMenu {
  $choice = [System.Windows.Forms.MessageBox]::Show('Choose OK to BACKUP or Cancel to RESTORE (Esc to abort).', 'TFP Backup/Restore', [System.Windows.Forms.MessageBoxButtons]::OKCancel)
  if ($choice -eq [System.Windows.Forms.DialogResult]::OK) { return 'Backup' }
  elseif ($choice -eq [System.Windows.Forms.DialogResult]::Cancel) { return 'Restore' }
  throw "Cancelled"
}

try {
  $config = Load-Config
  $config = Prompt-Connection $config
  $action = Show-MainMenu
  switch ($action) {
    'Backup' { Backup-Database $config }
    'Restore' { Restore-Database $config }
  }
} catch {
  Write-Warning $_
}

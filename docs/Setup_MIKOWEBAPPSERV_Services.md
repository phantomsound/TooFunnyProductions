# Setup_MIKOWEBAPPSERV_Services.ps1

Script: `scripts/Setup_MIKOWEBAPPSERV_Services.ps1`  
Run this on: **MIKOWEBAPPSERV** (server)

## Purpose
- Install Node/Python dependencies for apps copied from **MIKOHOME**
- Create Python virtual environments for **Melbot** and **MonitorSite**
- Recreate NSSM services for:
  - `TFPService`
  - `KBBGService`
  - `Melbot`
  - `MonitorSite`
  - `MikoCFTunnel` (TooFunny Cloudflare tunnel)
  - `KBBGTunnel` (KBBG Cloudflare tunnel)

## Prerequisites
- `C:\Apps` exists and contains:
  - `C:\Apps\TooFunnyProductions`
  - `C:\Apps\Melbot`
  - `C:\Apps\MonitorSite`
  - `C:\Apps\KBBG` (or your chosen KBBG folder)
  - `C:\Apps\Config\cloudflared\...`
- `nssm.exe` at `C:\Apps\nssm\nssm.exe` (or adjust `-NssmPath`)
- `cloudflared.exe` at `C:\Apps\cloudflared\cloudflared.exe` (or adjust `-CloudflaredExe`)
- Node.js and Python 3 installed and on `PATH`

## Quick start
```powershell
# From the repo root
pwsh -ExecutionPolicy Bypass -File scripts/Setup_MIKOWEBAPPSERV_Services.ps1 \
    -NssmPath "C:\\Apps\\nssm\\nssm.exe" \
    -CloudflaredExe "C:\\Apps\\cloudflared\\cloudflared.exe"
```

### What the script does
1. Ensures `C:\Apps\logs` exists for service output.
2. Installs Node dependencies and builds the frontend for **TooFunnyProductions** (if package.json is present).
3. Installs Node dependencies for **KBBG** (add build/start commands if needed).
4. Creates virtual environments and installs Python requirements for **Melbot** and **MonitorSite**.
5. Recreates NSSM services for the admin app, KBBG, Melbot, MonitorSite, and both Cloudflare tunnels, wiring stdout/stderr to `C:\Apps\logs`.

### Service checks
After running, verify services with:
```powershell
Get-Service TFPService, KBBGService, Melbot, MonitorSite, MikoCFTunnel, KBBGTunnel
```

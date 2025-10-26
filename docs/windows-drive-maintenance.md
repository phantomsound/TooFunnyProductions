# Windows Drive Maintenance Guide for `H:`

This guide outlines manual steps to help you verify free space, enable write caching, and configure backups for the `H:` drive on a Windows system. These instructions assume you have administrator privileges on the machine.

## 1. Verify Remaining Free Space on `H:`

1. Open **File Explorer** and select **This PC**.
2. Locate the `H:` drive and note the reported free space in the status bar.
3. To confirm accurate figures and factor in operating system overhead:
   1. Press `Win + R`, type `powershell`, and press **Enter**.
   2. Run the following command to retrieve detailed size information:

      ```powershell
      Get-PSDrive -Name H | Select-Object Used, Free, @{Name='Total';Expression={$_.Used + $_.Free}}
      ```
   3. Compare the reported free space to your threshold (250 GB + any additional buffer).
   4. Remember that Windows may reserve space for system metadata and shadow copies. Maintain at least 10% extra headroom beyond 250 GB if the drive hosts large media assets.

## 2. Enable Write Caching and Measure Drive Performance

> **Warning:** Enabling write caching without an uninterruptible power supply (UPS) may increase the risk of data loss during power failures.

1. Press `Win + X` and choose **Device Manager**.
2. Expand **Disk drives**, right-click the physical disk that backs `H:`, and choose **Properties**.
3. On the **Policies** tab:
   - Check **Enable write caching on the device**.
   - If available and safe for your environment, enable **Turn off Windows write-cache buffer flushing on the device** (recommended only when protected by a UPS).
4. Click **OK** and reboot if prompted.
5. Benchmark the drive to ensure there are no bottlenecks:
   1. Download and install a trusted disk benchmarking tool (e.g., **CrystalDiskMark**).
   2. Run sequential and random read/write tests targeting the `H:` volume.
   3. Compare results to the manufacturer’s specifications. If speeds are below expectations, investigate controller drivers, cabling, or thermal throttling.

## 3. Configure Regular Backups for `H:\apps\pgsql\data`

### Option A: File History

1. Connect a backup destination (external drive or network share).
2. Open **Settings → Update & Security → Backup**.
3. Click **Add a drive** and select the destination.
4. Choose **More options** and add `H:\apps\pgsql\data` to the list of folders to back up.
5. Set an appropriate backup frequency (e.g., hourly) and retention policy.

### Option B: Windows Server Backup / Task Scheduler with PowerShell

1. If File History is insufficient, create a scheduled PowerShell script:

   ```powershell
   $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
   $source = 'H:\apps\pgsql\data'
   $destination = "Z:\Backups\pgsql-data-$timestamp"
   robocopy $source $destination /MIR /R:3 /W:5 /LOG:"C:\Logs\pgsql-backup-$timestamp.log"
   ```

2. Save the script (e.g., `C:\Scripts\Backup-PgsqlData.ps1`).
3. Open **Task Scheduler** and create a new task:
   - Trigger: Daily or hourly, based on recovery objectives.
   - Action: Start a program → `powershell.exe -File C:\Scripts\Backup-PgsqlData.ps1`.
   - Enable **Run whether user is logged on or not** and **Run with highest privileges**.
4. Test the task manually and verify backups complete successfully.
5. Periodically validate that the backup destination has adequate free space and that restore procedures work.

### Option C: Volume Shadow Copies (Shadow Copies for Shared Folders)

1. Right-click `H:` in **File Explorer** and select **Properties**.
2. Open the **Shadow Copies** tab.
3. Select the `H:` volume and click **Enable**.
4. Configure the storage area (preferably on a different volume) and schedule snapshots as needed.
5. Document restore procedures so database data can be recovered quickly.

## 4. Ongoing Maintenance

- Monitor disk health using `Get-PhysicalDisk` or vendor utilities (SMART data).
- Keep firmware and storage controller drivers up to date.
- Review backup logs regularly and test restoration to a staging environment.

Following these steps will help ensure the `H:` drive maintains sufficient free space, benefits from write caching performance improvements, and has reliable backups in place.

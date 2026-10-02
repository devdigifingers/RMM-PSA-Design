//go:build windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

func loadPlatformEnv() {
	if os.Getenv("DF_API_URL") != "" {
		return
	}
	raw, err := os.ReadFile(`C:\ProgramData\DigitalFingers\df-agent.env`)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		key, value, _ := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"`)
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
}

func defaultStatePath() string {
	return `C:\ProgramData\DigitalFingers\df-agent\state.json`
}

func start() error {
	if err := os.MkdirAll(`C:\ProgramData\DigitalFingers`, 0o700); err != nil {
		return err
	}
	logFile, err := os.OpenFile(`C:\ProgramData\DigitalFingers\df-agent.log`, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	os.Stdout = logFile
	os.Stderr = logFile
	service, err := svc.IsWindowsService()
	if err != nil {
		return err
	}
	if service {
		return svc.Run("df-agent", agentService{})
	}
	return run(context.Background())
}

type agentService struct{}

func (agentService) Execute(_ []string, requests <-chan svc.ChangeRequest, statuses chan<- svc.Status) (bool, uint32) {
	statuses <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- run(ctx) }()
	statuses <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case err := <-done:
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				return false, 1
			}
			return false, 0
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				statuses <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				statuses <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case <-done:
				case <-time.After(25 * time.Second):
				}
				return false, 0
			}
		}
	}
}

func prettyOS() string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, "-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_OperatingSystem).Caption").Output()
	name := strings.TrimSpace(string(out))
	if err != nil || name == "" {
		return "Windows"
	}
	return name
}

func runCommand(command string) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, `C:\Windows\System32\cmd.exe`, "/d", "/s", "/c", command)
	cmd.Env = []string{
		`PATH=C:\Windows\System32;C:\Windows`,
		`SYSTEMROOT=C:\Windows`,
		`COMSPEC=C:\Windows\System32\cmd.exe`,
		`PATHEXT=.COM;.EXE;.BAT;.CMD`,
	}
	var buf bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &buf, max: 8000}
	cmd.Stderr = cmd.Stdout
	err := cmd.Run()
	if err == nil {
		return 0, buf.String()
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), buf.String()
	}
	if buf.Len() == 0 {
		buf.WriteString(err.Error())
	}
	return 1, buf.String()
}

func collectMetrics() (sample, error) {
	cpu, err := cpuPercent()
	if err != nil {
		return sample{}, err
	}
	memory, err := memoryUsage()
	if err != nil {
		return sample{}, err
	}
	disk, err := diskUsage(`C:\`)
	if err != nil {
		return sample{}, err
	}
	return sample{
		CPUPercent:       cpu,
		MemoryPercent:    memory.percent,
		MemoryUsedBytes:  memory.used,
		MemoryTotalBytes: memory.total,
		DiskPercent:      disk.percent,
		DiskUsedBytes:    disk.used,
		DiskTotalBytes:   disk.total,
		UptimeSeconds:    int64(windows.DurationSinceBoot() / time.Second),
	}, nil
}

func cpuPercent() (int, error) {
	idle1, total1, err := readCPU()
	if err != nil {
		return 0, err
	}
	time.Sleep(200 * time.Millisecond)
	idle2, total2, err := readCPU()
	if err != nil {
		return 0, err
	}
	if total2 <= total1 {
		return 0, nil
	}
	idle := idle2 - idle1
	total := total2 - total1
	if idle > total {
		return 0, nil
	}
	return int((total - idle) * 100 / total), nil
}

var (
	procGetSystemTimes       = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")
)

func readCPU() (idle, total uint64, err error) {
	var idleTime, kernelTime, userTime windows.Filetime
	result, _, callErr := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime)),
		uintptr(unsafe.Pointer(&kernelTime)),
		uintptr(unsafe.Pointer(&userTime)),
	)
	if result == 0 {
		if callErr != nil {
			return 0, 0, callErr
		}
		return 0, 0, fmt.Errorf("cpu sample unavailable")
	}
	idle = filetime(idleTime)
	total = filetime(kernelTime) + filetime(userTime)
	return idle, total, nil
}

func filetime(value windows.Filetime) uint64 {
	return uint64(value.HighDateTime)<<32 | uint64(value.LowDateTime)
}

type byteUsage struct {
	used, total int64
	percent     int
}

func memoryUsage() (byteUsage, error) {
	var status struct {
		Length               uint32
		MemoryLoad           uint32
		TotalPhys            uint64
		AvailPhys            uint64
		TotalPageFile        uint64
		AvailPageFile        uint64
		TotalVirtual         uint64
		AvailVirtual         uint64
		AvailExtendedVirtual uint64
	}
	status.Length = uint32(unsafe.Sizeof(status))
	result, _, callErr := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&status)))
	if result == 0 {
		if callErr != nil {
			return byteUsage{}, callErr
		}
		return byteUsage{}, fmt.Errorf("memory sample unavailable")
	}
	if status.TotalPhys == 0 || status.AvailPhys > status.TotalPhys {
		return byteUsage{}, fmt.Errorf("memory sample unavailable")
	}
	total := int64(status.TotalPhys)
	used := int64(status.TotalPhys - status.AvailPhys)
	return byteUsage{used: used, total: total, percent: int(used * 100 / total)}, nil
}

func collectUpdates() ([]updateItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	script := `$ErrorActionPreference = 'Stop'
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$searcher.ServerSelection = 2
$result = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
$list = New-Object System.Collections.Generic.List[object]
foreach ($update in $result.Updates) {
  $kb = ''
  $ids = @($update.KBArticleIDs)
  if ($ids.Count -gt 0 -and $ids[0]) { $kb = 'KB' + [string]$ids[0] }
  $list.Add([PSCustomObject]@{
    name = [string]$update.Title
    currentVersion = ''
    availableVersion = $kb
  }) | Out-Null
}
if ($list.Count -eq 0) { '[]' } else { ConvertTo-Json -Compress -InputObject @($list.ToArray()) }
`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		text := strings.TrimSpace(stderr.String())
		if len(text) > 300 {
			text = text[len(text)-300:]
		}
		return nil, fmt.Errorf("windows update: %v %s", err, text)
	}
	items, err := decodeUpdates(stdout.Bytes())
	if err != nil {
		return nil, err
	}
	if len(items) > 200 {
		items = items[:200]
	}
	cleaned := []updateItem{}
	for _, item := range items {
		item.Name = strings.TrimSpace(item.Name)
		item.CurrentVersion = strings.TrimSpace(item.CurrentVersion)
		item.AvailableVersion = strings.TrimSpace(item.AvailableVersion)
		if item.Name == "" {
			continue
		}
		if len(item.Name) > 200 {
			item.Name = item.Name[:200]
		}
		cleaned = append(cleaned, item)
	}
	return cleaned, nil
}

func installDeploy(name string) (bool, string) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 {
		return false, "That update name cannot be installed."
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	script := `$ErrorActionPreference = 'Stop'
$title = $env:DF_UPDATE_TITLE
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$searcher.ServerSelection = 2
$result = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
$target = $null
$kb = ''
if ($title -match 'KB(\d+)') { $kb = $Matches[1] }
foreach ($update in $result.Updates) {
  if ([string]$update.Title -eq $title) { $target = $update; break }
}
if (-not $target -and $kb -ne '') {
  foreach ($update in $result.Updates) {
    $ids = @($update.KBArticleIDs)
    if ($ids -contains $kb) { $target = $update; break }
  }
}
if (-not $target) { Write-Output 'update not found'; exit 1 }
if (-not $target.EulaAccepted) { $target.AcceptEula() }
$coll = New-Object -ComObject Microsoft.Update.UpdateColl
[void]$coll.Add($target)
if (-not $target.IsDownloaded) {
  $downloader = $session.CreateUpdateDownloader()
  $downloader.Updates = $coll
  $downloaded = $downloader.Download()
  if ($downloaded.ResultCode -ne 2) { Write-Output ('download result ' + $downloaded.ResultCode); exit 1 }
}
$installer = $session.CreateUpdateInstaller()
$installer.ClientApplicationID = 'Digital Fingers'
$installer.AllowSourcePrompts = $false
$installer.Updates = $coll
$installed = $installer.Install()
Write-Output ('result ' + $installed.ResultCode + ' reboot ' + $installed.RebootRequired)
if ($installed.ResultCode -eq 2) { exit 0 }
exit 1
`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "DF_UPDATE_TITLE="+name)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	detail := strings.TrimSpace(buf.String())
	if len(detail) > 2000 {
		detail = detail[len(detail)-2000:]
	}
	if err == nil {
		if detail == "" {
			detail = "Installed."
		}
		return true, detail
	}
	if detail == "" {
		detail = err.Error()
	}
	return false, detail
}

func diskUsage(path string) (byteUsage, error) {
	var free, total, unused uint64
	if err := windows.GetDiskFreeSpaceEx(windows.StringToUTF16Ptr(path), &free, &total, &unused); err != nil {
		return byteUsage{}, err
	}
	if total == 0 || free > total {
		return byteUsage{}, fmt.Errorf("disk sample unavailable")
	}
	used := int64(total - free)
	return byteUsage{used: used, total: int64(total), percent: int(used * 100 / int64(total))}, nil
}

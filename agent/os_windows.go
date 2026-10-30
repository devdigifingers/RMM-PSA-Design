//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const agentDir = `C:\ProgramData\DigitalFingers`

// The Windows agent runs as SYSTEM, so its server address is fixed rather than read from a file.
func apiURL() string {
	return "https://api.digitalfingers.co.za"
}

func loadPlatformEnv() {
	raw, err := os.ReadFile(filepath.Join(agentDir, "df-agent.env"))
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(raw), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(strings.TrimRight(line, "\r")), "=")
		if ok && strings.TrimSpace(key) == "DF_ENROLL_TOKEN" {
			_ = os.Setenv("DF_ENROLL_TOKEN", strings.Trim(strings.TrimSpace(value), `"`))
		}
	}
}

func defaultStatePath() string {
	return `C:\ProgramData\DigitalFingers\df-agent\state.json`
}

// lockAgentDir gives the agent folder to Administrators, allows only SYSTEM and Administrators,
// and strips owners and explicit permissions from everything inside so nothing keeps user access.
func lockAgentDir() error {
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		return err
	}
	top, err := windows.SecurityDescriptorFromString("O:BAD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
	if err != nil {
		return err
	}
	inner, err := windows.SecurityDescriptorFromString("O:BAD:AI")
	if err != nil {
		return err
	}
	topOwner, _, err := top.Owner()
	if err != nil {
		return err
	}
	topDACL, _, err := top.DACL()
	if err != nil || topDACL == nil {
		return fmt.Errorf("agent folder permissions could not be built")
	}
	innerOwner, _, err := inner.Owner()
	if err != nil {
		return err
	}
	innerDACL, _, err := inner.DACL()
	if err != nil || innerDACL == nil {
		return fmt.Errorf("agent folder permissions could not be built")
	}
	err = windows.SetNamedSecurityInfo(agentDir, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		topOwner, nil, topDACL, nil)
	if err != nil {
		return fmt.Errorf("agent folder permissions: %w", err)
	}
	return filepath.WalkDir(agentDir, func(path string, _ fs.DirEntry, walkErr error) error {
		if walkErr != nil || path == agentDir {
			return nil
		}
		err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
			windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.UNPROTECTED_DACL_SECURITY_INFORMATION,
			innerOwner, nil, innerDACL, nil)
		if err != nil {
			return fmt.Errorf("agent file permissions %s: %w", path, err)
		}
		return nil
	})
}

// placeEnrollFile copies the enrollment file shipped next to the installer. Without one, a file
// already in the folder is only kept when the PC is enrolled, since anyone could have left it there.
func placeEnrollFile() error {
	target := filepath.Join(agentDir, "df-agent.env")
	if exe, err := os.Executable(); err == nil {
		source := filepath.Join(filepath.Dir(exe), "df-agent.env")
		if !strings.EqualFold(source, target) {
			if raw, err := os.ReadFile(source); err == nil && len(raw) < 4096 {
				return os.WriteFile(target, raw, 0o600)
			}
		}
	}
	if _, err := os.Stat(defaultStatePath()); err != nil {
		_ = os.Remove(target)
	}
	return nil
}

func start() error {
	service, err := svc.IsWindowsService()
	if err != nil {
		return err
	}
	if !service {
		if hasArg("update") {
			return updateInPlace()
		}
		if uninstalling() {
			return uninstallInteractive()
		}
		return installInteractive()
	}
	if err := lockAgentDir(); err != nil {
		return err
	}
	logFile, err := os.OpenFile(`C:\ProgramData\DigitalFingers\df-agent.log`, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	os.Stdout = logFile
	os.Stderr = logFile
	return svc.Run("df-agent", agentService{})
}

func installInteractive() error {
	if !elevated() {
		if quiet() {
			return fmt.Errorf("run PowerShell as administrator and try again")
		}
		return relaunchElevated()
	}
	if err := lockAgentDir(); err != nil {
		return failed(err.Error())
	}
	dest := filepath.Join(agentDir, "df-agent.exe")
	_, stateBefore := os.Stat(defaultStatePath())
	if err := removeService(); err != nil {
		return failed(err.Error())
	}
	if err := copySelf(dest); err != nil {
		return failed("The old agent is still running. Close it and run this file again.")
	}
	if err := placeEnrollFile(); err != nil {
		return failed(err.Error())
	}
	if err := lockAgentDir(); err != nil {
		return failed(err.Error())
	}
	if err := installService(dest); err != nil {
		return failed(err.Error())
	}
	if err := registerProgram(dest); err != nil {
		return failed(err.Error())
	}
	_, envErr := os.Stat(filepath.Join(agentDir, "df-agent.env"))
	_, stateErr := os.Stat(defaultStatePath())
	if envErr != nil && stateErr != nil {
		return failed("Digital Fingers Agent is installed and listed in Apps. This PC has no enrollment file yet, so the device list cannot check in.")
	}
	if quiet() && stateBefore != nil {
		for i := 0; i < 45; i++ {
			if _, err := os.Stat(defaultStatePath()); err == nil {
				return tell("Digital Fingers Agent is installed. This computer now appears under Devices.")
			}
			time.Sleep(time.Second)
		}
		return fmt.Errorf("the agent is installed but has not checked in yet; see C:\\ProgramData\\DigitalFingers\\df-agent.log")
	}
	return tell("Digital Fingers Agent is installed and listed in Apps. This PC stays enrolled. Remote support sets itself up within a few minutes.")
}

// quiet is set by the command-line installer: results go to the console and failures set the exit code.
func quiet() bool {
	return hasArg("quiet")
}

func failed(text string) error {
	if quiet() {
		return fmt.Errorf("%s", text)
	}
	return tell(text)
}

func uninstalling() bool {
	return hasArg("uninstall")
}

func hasArg(name string) bool {
	for _, arg := range os.Args[1:] {
		switch strings.ToLower(arg) {
		case name, "/" + name, "-" + name:
			return true
		}
	}
	return false
}

func updateFilePath() string {
	return filepath.Join(agentDir, "df-agent-update.exe")
}

func launchUpdate(path string) error {
	cmd := exec.Command(path, "update")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// updateInPlace runs from the downloaded agent. It swaps it in for the installed agent and keeps
// the remote support agent and enrollment as they are. A new agent that will not start is rolled back.
func updateInPlace() error {
	if !elevated() {
		return fmt.Errorf("the agent update must run as an administrator")
	}
	logFile, err := os.OpenFile(filepath.Join(agentDir, "df-agent-update.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err == nil {
		defer logFile.Close()
		os.Stdout = logFile
		os.Stderr = logFile
	}
	say := func(text string) { fmt.Printf("%s %s\n", time.Now().Format(time.RFC3339), text) }
	say("updating to " + agentVersion)
	err = swapAgent(say)
	if err != nil {
		say("update failed: " + err.Error())
	} else {
		say("updated to " + agentVersion)
	}
	if exe, exeErr := os.Executable(); exeErr == nil && strings.EqualFold(filepath.Base(exe), "df-agent-update.exe") {
		cleanup := exec.Command(`C:\Windows\System32\cmd.exe`)
		cleanup.SysProcAttr = &syscall.SysProcAttr{
			HideWindow: true,
			CmdLine:    `C:\Windows\System32\cmd.exe /d /c ping -n 6 127.0.0.1 >nul & del /f /q "` + exe + `"`,
		}
		_ = cleanup.Start()
	}
	return err
}

func swapAgent(say func(string)) error {
	dest := filepath.Join(agentDir, "df-agent.exe")
	backup := filepath.Join(agentDir, "df-agent.old.exe")
	src, err := os.Executable()
	if err != nil {
		return err
	}
	if strings.EqualFold(filepath.Clean(src), dest) {
		return fmt.Errorf("the update must run from a separate file")
	}
	manager, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	service, err := manager.OpenService("df-agent")
	if err != nil {
		return fmt.Errorf("the agent service is not installed")
	}
	defer service.Close()
	if err := stopService(service); err != nil {
		return err
	}
	say("service stopped")
	if err := copyFile(dest, backup); err != nil {
		_ = service.Start()
		return fmt.Errorf("backup: %w", err)
	}
	if err := copyWithRetry(src, dest); err != nil {
		_ = copyWithRetry(backup, dest)
		_ = service.Start()
		return fmt.Errorf("replace: %w", err)
	}
	_ = lockAgentDir()
	_ = service.SetRecoveryActions([]mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: 5 * time.Second}}, 86400)
	_ = service.SetRecoveryActionsOnNonCrashFailures(true)
	if err := startAndHold(service); err != nil {
		say("new agent did not stay running, restoring: " + err.Error())
		_ = stopService(service)
		if restoreErr := copyWithRetry(backup, dest); restoreErr != nil {
			return fmt.Errorf("restore: %w", restoreErr)
		}
		_ = service.Start()
		return err
	}
	_ = registerProgram(dest)
	return nil
}

func stopService(service *mgr.Service) error {
	status, err := service.Query()
	if err != nil {
		return err
	}
	if status.State == svc.Stopped {
		return nil
	}
	_, _ = service.Control(svc.Stop)
	for i := 0; i < 80; i++ {
		status, err = service.Query()
		if err == nil && status.State == svc.Stopped {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	if status.ProcessId != 0 {
		if process, openErr := windows.OpenProcess(windows.PROCESS_TERMINATE, false, status.ProcessId); openErr == nil {
			_ = windows.TerminateProcess(process, 1)
			windows.CloseHandle(process)
		}
	}
	for i := 0; i < 20; i++ {
		status, err = service.Query()
		if err == nil && status.State == svc.Stopped {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("the agent service did not stop")
}

func startAndHold(service *mgr.Service) error {
	if err := service.Start(); err != nil {
		return err
	}
	running := false
	for i := 0; i < 60; i++ {
		status, err := service.Query()
		if err == nil && status.State == svc.Running {
			running = true
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if !running {
		return fmt.Errorf("the service did not start")
	}
	time.Sleep(15 * time.Second)
	status, err := service.Query()
	if err != nil || status.State != svc.Running {
		return fmt.Errorf("the service stopped after starting")
	}
	return nil
}

func copyWithRetry(src, dest string) error {
	var last error
	for i := 0; i < 20; i++ {
		last = copyFile(src, dest)
		if last == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return last
}

func uninstallInteractive() error {
	if !elevated() {
		return relaunchElevated()
	}
	if err := removeService(); err != nil {
		return tell(err.Error())
	}
	removeMesh()
	_ = registry.DeleteKey(registry.LOCAL_MACHINE, uninstallRegistry)
	removeProgramFile()
	return tell("Digital Fingers Agent was removed. It no longer appears in Apps.")
}

const uninstallRegistry = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Digital Fingers Agent`

func registerProgram(dest string) error {
	key, _, err := registry.CreateKey(registry.LOCAL_MACHINE, uninstallRegistry, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	values := []struct{ name, value string }{
		{"DisplayName", "Digital Fingers Agent"},
		{"DisplayVersion", agentVersion},
		{"Publisher", "Digital Fingers"},
		{"InstallLocation", `C:\ProgramData\DigitalFingers`},
		{"DisplayIcon", dest},
		{"UninstallString", `"` + dest + `" uninstall`},
	}
	for _, item := range values {
		if err := key.SetStringValue(item.name, item.value); err != nil {
			return err
		}
	}
	if err := key.SetDWordValue("NoModify", 1); err != nil {
		return err
	}
	if err := key.SetDWordValue("NoRepair", 1); err != nil {
		return err
	}
	if info, err := os.Stat(dest); err == nil && info.Size() > 0 {
		_ = key.SetDWordValue("EstimatedSize", uint32(info.Size()/1024))
	}
	return key.SetStringValue("InstallDate", time.Now().Format("20060102"))
}

// The remote support agent is the branded MeshCentral agent. The device agent downloads it from the
// API with its device login and installs it, instead of carrying it inside its own installer.
const remoteServiceName = "Mesh Agent"

var remoteInstallerPath = filepath.Join(agentDir, "DigitalFingersRemoteSupport.exe")

var remoteExePaths = []string{
	`C:\Program Files\Digital Fingers\Mesh Agent\MeshAgent.exe`,
	`C:\Program Files\Mesh Agent\MeshAgent.exe`,
}

func remoteAgentLoop(ctx context.Context, api string, state savedState) {
	var lastStart, lastRepair time.Time
	wait := 30 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = 2 * time.Minute
		current, disabled, err := remoteServiceState()
		if err != nil {
			continue
		}
		switch current {
		case "running":
			setRemoteStatus("running", "", time.Time{})
		case "stopped":
			detail := "The remote support service is stopped."
			if disabled {
				detail = "The remote support service is disabled on this device."
			} else if time.Since(lastStart) >= 10*time.Minute {
				lastStart = time.Now()
				if err := startRemoteService(); err != nil {
					detail = "The remote support service would not start: " + err.Error()
				} else if waitRemoteRunning(ctx, 30*time.Second) {
					setRemoteStatus("running", "", time.Time{})
					continue
				}
			}
			setRemoteStatus("stopped", detail, time.Time{})
		case "missing":
			sum, _ := remoteSHA.Load().(string)
			if sum == "" {
				if prev := remoteReport.Load(); prev == nil || (prev.State != "missing" && prev.State != "blocked") {
					setRemoteStatus("missing", "The remote support agent is not installed.", time.Time{})
				}
				wait = 20 * time.Second
				continue
			}
			if time.Since(lastRepair) < time.Hour {
				if prev := remoteReport.Load(); prev == nil || prev.State == "running" || prev.State == "repairing" {
					setRemoteStatus("missing", "The remote support agent is not installed.", time.Time{})
				}
				continue
			}
			lastRepair = time.Now()
			setRemoteStatus("repairing", "", time.Time{})
			blocked, err := repairRemoteAgent(ctx, api, state, sum)
			switch {
			case err == nil:
				setRemoteStatus("running", "", time.Now())
			case blocked:
				setRemoteStatus("blocked", err.Error(), time.Time{})
			default:
				setRemoteStatus("missing", err.Error(), time.Time{})
			}
			fmt.Printf("remote support repair: %v\n", err)
		}
	}
}

// remoteServiceState reports running, stopped or missing (no service, or its program file is gone).
func remoteServiceState() (string, bool, error) {
	m, err := mgr.Connect()
	if err != nil {
		return "", false, err
	}
	defer m.Disconnect()
	service, err := m.OpenService(remoteServiceName)
	if err != nil {
		return "missing", false, nil
	}
	defer service.Close()
	status, err := service.Query()
	if err != nil {
		return "", false, err
	}
	if remoteAgentPath() == "" {
		return "missing", false, nil
	}
	if status.State == svc.Running || status.State == svc.StartPending {
		return "running", false, nil
	}
	config, err := service.Config()
	return "stopped", err == nil && config.StartType == mgr.StartDisabled, nil
}

// remoteAgentPath finds the installed remote agent from its service, then the known install folders.
func remoteAgentPath() string {
	if m, err := mgr.Connect(); err == nil {
		defer m.Disconnect()
		if service, err := m.OpenService(remoteServiceName); err == nil {
			config, err := service.Config()
			service.Close()
			if err == nil {
				if path := serviceProgram(config.BinaryPathName); path != "" {
					if _, err := os.Stat(path); err == nil {
						return path
					}
				}
			}
		}
	}
	for _, path := range remoteExePaths {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}

func serviceProgram(commandLine string) string {
	commandLine = strings.TrimSpace(commandLine)
	if strings.HasPrefix(commandLine, `"`) {
		if end := strings.Index(commandLine[1:], `"`); end > 0 {
			return commandLine[1 : end+1]
		}
		return ""
	}
	if i := strings.Index(strings.ToLower(commandLine), ".exe"); i >= 0 {
		return commandLine[:i+4]
	}
	return commandLine
}

func startRemoteService() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	service, err := m.OpenService(remoteServiceName)
	if err != nil {
		return err
	}
	defer service.Close()
	return service.Start()
}

func waitRemoteRunning(ctx context.Context, limit time.Duration) bool {
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if current, _, err := remoteServiceState(); err == nil && current == "running" {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(2 * time.Second):
		}
	}
	return false
}

// repairRemoteAgent downloads (or reuses) the published installer and runs it. blocked means the
// file was removed or refused by the system, which is what antivirus quarantine looks like.
func repairRemoteAgent(ctx context.Context, api string, state savedState, want string) (bool, error) {
	if !fileMatches(remoteInstallerPath, want) {
		if err := downloadRemoteAgent(ctx, api, state, want); err != nil {
			return false, err
		}
	}
	select {
	case <-ctx.Done():
		return false, ctx.Err()
	case <-time.After(5 * time.Second):
	}
	if !fileMatches(remoteInstallerPath, want) {
		return true, fmt.Errorf("the remote support installer was removed right after download, most likely by antivirus")
	}
	runCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(runCtx, remoteInstallerPath, "-fullinstall")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, runErr := cmd.CombinedOutput()
	if errors.Is(runErr, syscall.Errno(225)) {
		return true, fmt.Errorf("Windows refused to run the remote support installer because antivirus flagged it")
	}
	if waitRemoteRunning(ctx, 45*time.Second) {
		return false, nil
	}
	if _, err := os.Stat(remoteInstallerPath); err != nil {
		return true, fmt.Errorf("the remote support installer was removed during install, most likely by antivirus")
	}
	if current, _, err := remoteServiceState(); err == nil && current == "missing" && remoteServiceExists() {
		return true, fmt.Errorf("the remote support service is installed but its program file was removed, most likely by antivirus")
	}
	detail := clip(strings.TrimSpace(string(out)), 200)
	if detail == "" && runErr != nil {
		detail = runErr.Error()
	}
	if detail == "" {
		detail = "no output"
	}
	return false, fmt.Errorf("remote support did not start after install: %s", detail)
}

func remoteServiceExists() bool {
	m, err := mgr.Connect()
	if err != nil {
		return false
	}
	defer m.Disconnect()
	service, err := m.OpenService(remoteServiceName)
	if err != nil {
		return false
	}
	service.Close()
	return true
}

func downloadRemoteAgent(ctx context.Context, api string, state savedState, want string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api+"/v1/agent/remote/windows", nil)
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Device "+state.DeviceToken)
	res, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return fmt.Errorf("remote support download: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("remote support download: HTTP %d", res.StatusCode)
	}
	part := remoteInstallerPath + ".part"
	out, err := os.OpenFile(part, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(res.Body, 64<<20+1))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err == nil && size > 64<<20 {
		err = fmt.Errorf("the remote support download is too large")
	}
	if err == nil && hex.EncodeToString(hash.Sum(nil)) != want {
		err = fmt.Errorf("the remote support download does not match the published hash")
	}
	if err == nil {
		err = os.Rename(part, remoteInstallerPath)
	}
	if err != nil {
		_ = os.Remove(part)
	}
	return err
}

func fileMatches(path, want string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, io.LimitReader(file, 64<<20+1)); err != nil {
		return false
	}
	return hex.EncodeToString(hash.Sum(nil)) == want
}

func removeMesh() {
	if path := remoteAgentPath(); path != "" {
		cmd := exec.Command(path, "-fulluninstall")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		_ = cmd.Run()
	}
	_ = os.Remove(remoteInstallerPath)
}

func removeProgramFile() {
	cmd := exec.Command(`C:\Windows\System32\cmd.exe`)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
		CmdLine:    `C:\Windows\System32\cmd.exe /d /c ping -n 4 127.0.0.1 >nul & del /f /q "C:\ProgramData\DigitalFingers\df-agent.exe"`,
	}
	_ = cmd.Start()
}

func removeService() error {
	manager, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	service, err := manager.OpenService("df-agent")
	if err != nil {
		return nil
	}
	defer service.Close()
	_, _ = service.Control(svc.Stop)
	for i := 0; i < 20; i++ {
		status, queryErr := service.Query()
		if queryErr != nil || status.State == svc.Stopped {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	return service.Delete()
}

func installService(dest string) error {
	var manager *mgr.Mgr
	var err error
	var service *mgr.Service
	for i := 0; i < 20; i++ {
		manager, err = mgr.Connect()
		if err != nil {
			return err
		}
		service, err = manager.CreateService("df-agent", dest, mgr.Config{
			DisplayName: "Digital Fingers Agent",
			Description: "Digital Fingers device agent",
			StartType:   mgr.StartAutomatic,
		})
		if err == nil {
			break
		}
		manager.Disconnect()
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	_ = service.SetRecoveryActions([]mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: 5 * time.Second}}, 86400)
	_ = service.SetRecoveryActionsOnNonCrashFailures(true)
	return service.Start()
}

func elevated() bool {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token); err != nil {
		return false
	}
	defer token.Close()
	return token.IsElevated()
}

func relaunchElevated() error {
	exe, err := os.Executable()
	if err != nil {
		return tell(err.Error())
	}
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return tell(err.Error())
	}
	file, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return tell(err.Error())
	}
	var args *uint16
	if uninstalling() {
		args, err = windows.UTF16PtrFromString("uninstall")
		if err != nil {
			return tell(err.Error())
		}
	}
	if err := windows.ShellExecute(0, verb, file, args, nil, windows.SW_SHOWNORMAL); err != nil {
		return tell("Administrator approval is required to install the agent.")
	}
	return nil
}

func copySelf(dest string) error {
	src, err := os.Executable()
	if err != nil {
		return err
	}
	absSrc, err := filepath.Abs(src)
	if err != nil {
		return err
	}
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	if strings.EqualFold(absSrc, absDest) {
		return nil
	}
	var last error
	for i := 0; i < 10; i++ {
		last = copyFile(absSrc, absDest)
		if last == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return last
}

func copyFile(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func tell(text string) error {
	if quiet() {
		fmt.Println(text)
		return nil
	}
	title, _ := windows.UTF16PtrFromString("Digital Fingers Agent")
	body, _ := windows.UTF16PtrFromString(text)
	_, _ = windows.MessageBox(0, body, title, windows.MB_OK|windows.MB_ICONINFORMATION)
	return nil
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

func osRelease() (string, string) {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return "", ""
	}
	defer key.Close()
	version, _, _ := key.GetStringValue("DisplayVersion")
	if version == "" {
		version, _, _ = key.GetStringValue("ReleaseId")
	}
	build, _, _ := key.GetStringValue("CurrentBuild")
	if ubr, _, err := key.GetIntegerValue("UBR"); err == nil && build != "" {
		build = fmt.Sprintf("%s.%d", build, ubr)
	}
	return version, build
}

func runCommand(command string) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, `C:\Windows\System32\cmd.exe`, "/d", "/s", "/c", command)
	computer, err := os.Hostname()
	if err != nil || computer == "" {
		computer = "localhost"
	}
	cmd.Env = []string{
		`PATH=C:\Windows\System32;C:\Windows`,
		`SYSTEMROOT=C:\Windows`,
		`WINDIR=C:\Windows`,
		`COMSPEC=C:\Windows\System32\cmd.exe`,
		`PATHEXT=.COM;.EXE;.BAT;.CMD`,
		"COMPUTERNAME=" + computer,
	}
	// cmd.exe does not understand Go's \" escaping, so the command line is passed through untouched.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
		CmdLine:    `C:\Windows\System32\cmd.exe /d /s /c "` + command + `"`,
	}
	var buf bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &buf, max: 8000}
	cmd.Stderr = cmd.Stdout
	cmd.WaitDelay = 5 * time.Second
	job, jobErr := windows.CreateJobObject(nil, nil)
	if jobErr == nil {
		defer windows.CloseHandle(job)
		cmd.Cancel = func() error {
			_ = windows.TerminateJobObject(job, 1)
			return cmd.Process.Kill()
		}
	}
	if err = cmd.Start(); err == nil {
		if jobErr == nil {
			if process, openErr := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid)); openErr == nil {
				_ = windows.AssignProcessToJobObject(job, process)
				windows.CloseHandle(process)
			}
		}
		err = cmd.Wait()
	}
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

func collectAsset() (asset, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	script := `$ErrorActionPreference = 'Stop'
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$tab = [char]9
function Clean([string]$value) { if ($null -eq $value) { return '' }; return (($value -replace "[\r\n\t]", ' ').Trim()) }
Write-Output ('MAKE' + $tab + (Clean $cs.Manufacturer))
Write-Output ('MODEL' + $tab + (Clean $cs.Model))
Write-Output ('SERIAL' + $tab + (Clean $bios.SerialNumber))
$paths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($item in (Get-ItemProperty $paths -ErrorAction SilentlyContinue)) {
  if ($item.DisplayName) {
    Write-Output ('APP' + $tab + (Clean $item.DisplayName) + $tab + (Clean ([string]$item.DisplayVersion)))
  }
}
`
	cmd := exec.CommandContext(ctx, `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, "-NoProfile", "-NonInteractive", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return asset{}, fmt.Errorf("asset: %w", err)
	}
	parsed := asset{Software: []softwareItem{}}
	for _, line := range strings.Split(decodePowerShell(out), "\n") {
		line = strings.TrimSpace(line)
		kind, rest, ok := strings.Cut(line, "\t")
		if !ok {
			continue
		}
		switch kind {
		case "MAKE":
			parsed.Make = strings.TrimSpace(rest)
		case "MODEL":
			parsed.Model = strings.TrimSpace(rest)
		case "SERIAL":
			parsed.Serial = strings.TrimSpace(rest)
		case "APP":
			name, version, _ := strings.Cut(rest, "\t")
			name = strings.TrimSpace(name)
			if name == "" || len(parsed.Software) >= 4000 {
				continue
			}
			parsed.Software = append(parsed.Software, softwareItem{Name: name, Version: strings.TrimSpace(version)})
		}
	}
	return parsed, nil
}

func decodePowerShell(out []byte) string {
	if len(out) >= 2 && out[0] == 0xFF && out[1] == 0xFE {
		out = out[2:]
	}
	nuls := bytes.Count(out, []byte{0})
	if nuls == 0 || nuls < len(out)/4 {
		return string(out)
	}
	if len(out)%2 == 1 {
		out = out[:len(out)-1]
	}
	units := make([]uint16, len(out)/2)
	for i := range units {
		units[i] = uint16(out[i*2]) | uint16(out[i*2+1])<<8
	}
	return string(utf16.Decode(units))
}

func collectUpdates() (updateScan, error) {
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
  $category = ''
  $categoryId = ''
  foreach ($item in $update.Categories) {
    if ([string]$item.Type -eq 'UpdateClassification') { $category = [string]$item.Name; $categoryId = [string]$item.CategoryID; break }
  }
  $restart = $false
  try { $restart = ([int]$update.InstallationBehavior.RebootBehavior) -ne 0 } catch {}
  $size = [int64]0
  try { $size = [int64]$update.MaxDownloadSize } catch {}
  $list.Add([PSCustomObject]@{
    name = [string]$update.Title
    currentVersion = ''
    availableVersion = $kb
    kb = $kb
    severity = [string]$update.MsrcSeverity
    category = $category
    categoryId = $categoryId
    sizeBytes = $size
    restart = $restart
  }) | Out-Null
}
$pending = $false
try { $pending = [bool](New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired } catch {}
ConvertTo-Json -Compress -Depth 4 -InputObject ([PSCustomObject]@{ updates = @($list.ToArray()); rebootPending = $pending })
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
		return updateScan{}, fmt.Errorf("windows update: %v %s", err, text)
	}
	return decodeScan([]byte(decodePowerShell(stdout.Bytes())))
}

func installDeploy(name string) (bool, bool, string) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 200 {
		return false, false, "That update name cannot be installed."
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
	restart := strings.Contains(detail, "reboot True")
	if err == nil {
		if detail == "" {
			detail = "Installed."
		}
		return true, restart, detail
	}
	if detail == "" {
		detail = err.Error()
	}
	return false, restart, detail
}

func collectUsers() []string {
	names := sessionUsers()
	if len(names) > 0 {
		return names
	}
	out, err := exec.Command(`C:\Windows\System32\query.exe`, "user").Output()
	if err != nil {
		return []string{}
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(strings.TrimPrefix(strings.TrimSpace(line), ">"))
		if len(fields) == 0 {
			continue
		}
		name := strings.TrimPrefix(fields[0], ">")
		if name == "" || strings.EqualFold(name, "USERNAME") || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
		if len(names) == 20 {
			break
		}
	}
	return names
}

func sessionUsers() []string {
	mod := windows.NewLazySystemDLL("wtsapi32.dll")
	enumerate := mod.NewProc("WTSEnumerateSessionsW")
	query := mod.NewProc("WTSQuerySessionInformationW")
	free := mod.NewProc("WTSFreeMemory")
	var raw uintptr
	var count uint32
	result, _, _ := enumerate.Call(0, 0, 1, uintptr(unsafe.Pointer(&raw)), uintptr(unsafe.Pointer(&count)))
	if result == 0 || raw == 0 {
		return nil
	}
	defer free.Call(raw)
	names := []string{}
	seen := map[string]bool{}
	step := unsafe.Sizeof(wtsSession{})
	for i := uint32(0); i < count; i++ {
		session := (*wtsSession)(unsafe.Pointer(raw + uintptr(i)*step))
		if session.State != 0 && session.State != 1 && session.State != 4 {
			continue
		}
		var buf uintptr
		var size uint32
		result, _, _ = query.Call(0, uintptr(session.SessionID), 5, uintptr(unsafe.Pointer(&buf)), uintptr(unsafe.Pointer(&size)))
		if result == 0 || buf == 0 {
			continue
		}
		name := strings.TrimSpace(windows.UTF16PtrToString((*uint16)(unsafe.Pointer(buf))))
		free.Call(buf)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
		if len(names) == 20 {
			break
		}
	}
	return names
}

type wtsSession struct {
	SessionID uint32
	Station   *uint16
	State     uint32
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

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

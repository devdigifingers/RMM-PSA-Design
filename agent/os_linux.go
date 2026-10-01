//go:build linux

package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"strings"
	"time"
)

func loadPlatformEnv() {}

func defaultStatePath() string {
	return "/var/lib/df-agent/state.json"
}

func start() error {
	return run(context.Background())
}

func prettyOS() string {
	raw, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return "Linux"
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
		}
	}
	return "Linux"
}

func runCommand(command string) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", command)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C"}
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

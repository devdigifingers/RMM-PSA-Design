//go:build linux

package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
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

func collectMetrics() (sample, error) {
	cpu, err := cpuPercent()
	if err != nil {
		return sample{}, err
	}
	memory, err := readMeminfo()
	if err != nil {
		return sample{}, err
	}
	disk, err := diskUsage("/")
	if err != nil {
		return sample{}, err
	}
	uptime, err := readUptime()
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
		UptimeSeconds:    uptime,
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
	return percentUsed(idle1, total1, idle2, total2), nil
}

func readCPU() (idle, total uint64, err error) {
	raw, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	line, _, _ := strings.Cut(string(raw), "\n")
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, fmt.Errorf("cpu sample unavailable")
	}
	var values []uint64
	for _, field := range fields[1:] {
		value, convErr := strconv.ParseUint(field, 10, 64)
		if convErr != nil {
			return 0, 0, convErr
		}
		values = append(values, value)
		total += value
	}
	if len(values) > 3 {
		idle = values[3]
	}
	if len(values) > 4 {
		idle += values[4]
	}
	return idle, total, nil
}

type byteUsage struct {
	used, total int64
	percent     int
}

func readMeminfo() (byteUsage, error) {
	raw, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return byteUsage{}, err
	}
	var totalKB, availKB uint64
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, convErr := strconv.ParseUint(fields[1], 10, 64)
		if convErr != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalKB = value
		case "MemAvailable:":
			availKB = value
		}
	}
	if totalKB == 0 || availKB > totalKB {
		return byteUsage{}, fmt.Errorf("memory sample unavailable")
	}
	total := int64(totalKB * 1024)
	used := int64((totalKB - availKB) * 1024)
	return byteUsage{used: used, total: total, percent: int(used * 100 / total)}, nil
}

func diskUsage(path string) (byteUsage, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return byteUsage{}, err
	}
	total := int64(stat.Blocks) * int64(stat.Bsize)
	free := int64(stat.Bavail) * int64(stat.Bsize)
	if total <= 0 || free < 0 || free > total {
		return byteUsage{}, fmt.Errorf("disk sample unavailable")
	}
	used := total - free
	return byteUsage{used: used, total: total, percent: int(used * 100 / total)}, nil
}

func readUptime() (int64, error) {
	raw, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}
	field, _, _ := strings.Cut(string(raw), " ")
	seconds, err := strconv.ParseFloat(field, 64)
	if err != nil || seconds < 0 {
		return 0, fmt.Errorf("uptime sample unavailable")
	}
	return int64(seconds), nil
}

func collectUpdates() ([]updateItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	list := exec.CommandContext(ctx, "apt", "list", "--upgradable")
	list.Env = []string{"LANG=C", "PATH=/usr/bin:/bin"}
	out, err := list.Output()
	if err != nil {
		return nil, fmt.Errorf("apt list: %w", err)
	}
	return parseAptUpgradable(out), nil
}

func parseAptUpgradable(raw []byte) []updateItem {
	items := []updateItem{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Listing") {
			continue
		}
		name, rest, ok := strings.Cut(line, "/")
		if !ok || name == "" {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) < 2 {
			continue
		}
		marker := "[upgradable from: "
		start := strings.Index(line, marker)
		if start < 0 {
			continue
		}
		current := strings.TrimSpace(strings.TrimSuffix(line[start+len(marker):], "]"))
		available := fields[1]
		if current == "" || available == "" {
			continue
		}
		items = append(items, updateItem{Name: name, CurrentVersion: current, AvailableVersion: available})
		if len(items) >= 200 {
			break
		}
	}
	return items
}

func installDeploy(name string) (bool, string) {
	if !aptPackageName(name) {
		return false, "That package name cannot be installed."
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "apt-get", "install", "-y", "--only-upgrade", name)
	cmd.Env = []string{"DEBIAN_FRONTEND=noninteractive", "LANG=C", "PATH=/usr/bin:/bin"}
	var buf bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &buf, max: 2000}
	cmd.Stderr = cmd.Stdout
	err := cmd.Run()
	detail := strings.TrimSpace(buf.String())
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

func aptPackageName(name string) bool {
	if name == "" || len(name) > 80 {
		return false
	}
	for i, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case i > 0 && (r == '+' || r == '-' || r == '.'):
		default:
			return false
		}
	}
	return true
}

func percentUsed(idle1, total1, idle2, total2 uint64) int {
	if total2 <= total1 {
		return 0
	}
	idle := idle2 - idle1
	total := total2 - total1
	if idle > total {
		return 0
	}
	return int((total - idle) * 100 / total)
}

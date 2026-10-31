//go:build linux

package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func loadPlatformEnv() {}

func updateFilePath() string { return "" }

// The Linux remote agent is installed by install-linux.sh and runs under systemd.
func remoteAgentLoop(context.Context, string, savedState) {}

func launchUpdate(string) error { return fmt.Errorf("self update is not supported on Linux") }

func apiURL() string {
	return strings.TrimRight(os.Getenv("DF_API_URL"), "/")
}

func defaultStatePath() string {
	return "/var/lib/df-agent/state.json"
}

func start() error {
	if len(os.Args) > 1 && os.Args[1] == "patch-helper" {
		return runPatchHelper()
	}
	if len(os.Args) > 1 && os.Args[1] == "version" {
		fmt.Println(agentVersion)
		return nil
	}
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

func osRelease() (string, string) {
	version := ""
	if raw, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if strings.HasPrefix(line, "VERSION_ID=") {
				version = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), `"`)
			}
		}
	}
	kernel, _ := os.ReadFile("/proc/sys/kernel/osrelease")
	return version, strings.TrimSpace(string(kernel))
}

func runCommand(command string) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", command)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C"}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 5 * time.Second
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

func runScript(int64, string) (int, string) {
	return 1, "Scripts run on Windows devices only."
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

func collectAsset() (asset, error) {
	software, err := installedPackages()
	if err != nil {
		return asset{}, err
	}
	serial := readTrim("/sys/class/dmi/id/product_serial")
	if serial == "" {
		serial = readTrim("/sys/class/dmi/id/product_uuid")
	}
	return asset{
		Make:     readTrim("/sys/class/dmi/id/sys_vendor"),
		Model:    readTrim("/sys/class/dmi/id/product_name"),
		Serial:   serial,
		Software: software,
	}, nil
}

func readTrim(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func usesApt() bool {
	_, err := os.Stat("/usr/bin/apt-get")
	return err == nil
}

func installedPackages() ([]softwareItem, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if usesApt() {
		cmd = exec.CommandContext(ctx, "dpkg-query", "-W", "-f", "${Package}\t${Version}\n")
	} else {
		cmd = exec.CommandContext(ctx, "rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n")
	}
	cmd.Env = []string{"LANG=C", "PATH=/usr/bin:/bin"}
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("package list: %w", err)
	}
	items := []softwareItem{}
	for _, line := range strings.Split(string(out), "\n") {
		name, version, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if !ok || name == "" {
			continue
		}
		items = append(items, softwareItem{Name: name, Version: version})
		if len(items) >= 4000 {
			break
		}
	}
	return items, nil
}

func collectUpdates() (updateScan, error) {
	if !usesApt() {
		return collectDnfUpdates()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	list := exec.CommandContext(ctx, "apt", "list", "--upgradable")
	list.Env = []string{"LANG=C", "PATH=/usr/bin:/bin"}
	out, err := list.Output()
	if err != nil {
		return updateScan{}, fmt.Errorf("apt list: %w", err)
	}
	return updateScan{Updates: cleanUpdates(parseAptUpgradable(out)), RebootPending: rebootRequired()}, nil
}

// dnf refreshes repository metadata into a root-owned cache, so the scan runs in the helper.
func collectDnfUpdates() (updateScan, error) {
	ok, out := helperCall("scan", 10*time.Minute, 256<<10)
	if !ok {
		return updateScan{}, fmt.Errorf("dnf check-update: %s", out)
	}
	items := parseDnfCheckUpdate([]byte(out))
	if len(items) > 0 {
		current := installedVersions(items)
		for i := range items {
			items[i].CurrentVersion = current[items[i].Name]
			if items[i].CurrentVersion == "" {
				items[i].CurrentVersion = "installed"
			}
		}
	}
	return updateScan{Updates: cleanUpdates(items), RebootPending: rebootRequired()}, nil
}

func installedVersions(items []updateItem) map[string]string {
	args := []string{"-q", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n"}
	for _, item := range items {
		args = append(args, item.Name)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "rpm", args...)
	cmd.Env = []string{"LANG=C", "PATH=/usr/bin:/bin"}
	out, _ := cmd.Output()
	versions := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		name, version, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if ok {
			versions[name] = version
		}
	}
	return versions
}

// parseDnfCheckUpdate reads "name.arch  version  repo" rows and stops at the obsoletes section.
func parseDnfCheckUpdate(raw []byte) []updateItem {
	items := []updateItem{}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "Obsoleting") {
			break
		}
		fields := strings.Fields(line)
		if len(fields) != 3 || strings.HasPrefix(line, " ") {
			continue
		}
		dot := strings.LastIndex(fields[0], ".")
		if dot <= 0 {
			continue
		}
		name := fields[0][:dot]
		if !linuxPackageName(name) || seen[name] || !strings.ContainsAny(fields[1], "0123456789") {
			continue
		}
		seen[name] = true
		items = append(items, updateItem{Name: name, AvailableVersion: fields[1], Category: "Update"})
		if len(items) >= 200 {
			break
		}
	}
	return items
}

func rebootRequired() bool {
	if _, err := os.Stat("/var/run/reboot-required"); err == nil {
		return true
	}
	if usesApt() {
		return false
	}
	for _, args := range [][]string{{"needs-restarting", "-r"}, {"dnf", "needs-restarting", "-r"}} {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		cmd := exec.CommandContext(ctx, args[0], args[1:]...)
		cmd.Env = []string{"LANG=C", "PATH=/usr/bin:/bin"}
		out, err := cmd.CombinedOutput()
		cancel()
		text := string(out)
		if strings.Contains(text, "Reboot is required") {
			return true
		}
		if err == nil || strings.Contains(text, "Reboot should not be necessary") {
			return false
		}
	}
	return false
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
		category := "Update"
		if strings.Contains(fields[0], "-security") {
			category = "Security"
		}
		items = append(items, updateItem{Name: name, CurrentVersion: current, AvailableVersion: available, Category: category})
		if len(items) >= 200 {
			break
		}
	}
	return items
}

func installDeploy(name string) (bool, bool, string) {
	if !linuxPackageName(name) {
		return false, false, "That package name cannot be installed."
	}
	ok, detail := helperCall("install "+name, 11*time.Minute, 4000)
	if ok && detail == "" {
		detail = "Installed."
	}
	return ok, rebootRequired(), detail
}

func helperCall(request string, wait time.Duration, max int) (bool, string) {
	conn, err := net.DialTimeout("unix", patchHelperSocket, 3*time.Second)
	if err != nil {
		return false, "The install helper is not available."
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(wait))
	if _, err := conn.Write([]byte(request + "\n")); err != nil {
		return false, "The install helper did not accept the request."
	}
	var buf bytes.Buffer
	tmp := make([]byte, 4096)
	for buf.Len() < max {
		n, readErr := conn.Read(tmp)
		if n > 0 {
			buf.Write(tmp[:n])
		}
		if readErr != nil {
			break
		}
	}
	text := buf.String()
	if strings.HasPrefix(text, "ok\n") {
		return true, strings.TrimSpace(strings.TrimPrefix(text, "ok\n"))
	}
	if strings.HasPrefix(text, "fail\n") {
		detail := strings.TrimSpace(strings.TrimPrefix(text, "fail\n"))
		if detail == "" {
			detail = "The install failed."
		}
		return false, detail
	}
	return false, "The install helper returned an unexpected result."
}

func collectUsers() []string {
	out, err := exec.Command("who").Output()
	if err != nil {
		return []string{}
	}
	seen := map[string]bool{}
	names := []string{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 || seen[fields[0]] {
			continue
		}
		seen[fields[0]] = true
		names = append(names, fields[0])
		if len(names) == 20 {
			break
		}
	}
	return names
}

// rpm names may contain capitals and underscores; neither may start with a dash.
func linuxPackageName(name string) bool {
	if name == "" || len(name) > 80 {
		return false
	}
	for i, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case i > 0 && (r == '+' || r == '-' || r == '.' || r == '_'):
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

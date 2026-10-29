//go:build linux

package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const patchHelperSocket = "/run/df-patch-helper.sock"

// runPatchHelper runs as root and performs the only two package actions the unprivileged agent
// may ask for: a dnf update scan and the upgrade of one already installed package.
func runPatchHelper() error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("the patch helper must run as root")
	}
	group, err := user.LookupGroup("dfagent")
	if err != nil {
		return fmt.Errorf("group dfagent: %w", err)
	}
	gid, err := strconv.Atoi(group.Gid)
	if err != nil {
		return err
	}
	_ = os.Remove(patchHelperSocket)
	previous := syscall.Umask(0o177)
	listener, err := net.Listen("unix", patchHelperSocket)
	syscall.Umask(previous)
	if err != nil {
		return err
	}
	if err := os.Chown(patchHelperSocket, 0, gid); err != nil {
		return err
	}
	if err := os.Chmod(patchHelperSocket, 0o660); err != nil {
		return err
	}
	fmt.Println("df-patch-helper listening")
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		handlePatchRequest(conn)
	}
}

func handlePatchRequest(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	line, err := bufio.NewReader(io.LimitReader(conn, 160)).ReadString('\n')
	if err != nil {
		return
	}
	request := strings.TrimSpace(line)
	var ok bool
	var detail string
	switch {
	case request == "scan":
		ok, detail = packageScan()
	case strings.HasPrefix(request, "install "):
		ok, detail = packageUpgrade(strings.TrimPrefix(request, "install "))
	default:
		ok, detail = false, "Unknown request."
	}
	fmt.Printf("%s %s\n", map[bool]string{true: "ok", false: "fail"}[ok], request)
	_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	prefix := "fail\n"
	if ok {
		prefix = "ok\n"
	}
	_, _ = conn.Write([]byte(prefix + detail))
}

func dnfBinary() string {
	for _, path := range []string{"/usr/bin/dnf", "/usr/bin/yum"} {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}

func packageScan() (bool, string) {
	dnf := dnfBinary()
	if dnf == "" {
		return false, "dnf is not installed."
	}
	code, out := rootRun(10*time.Minute, 256<<10, dnf, "-q", "check-update")
	if code == 0 || code == 100 {
		return true, out
	}
	return false, tail(out, 1500)
}

func packageUpgrade(name string) (bool, string) {
	if !linuxPackageName(name) {
		return false, "That package name cannot be installed."
	}
	var code int
	var out string
	if usesApt() {
		code, out = rootRun(10*time.Minute, 64<<10, "/usr/bin/apt-get", "install", "-y", "--only-upgrade", name)
	} else if dnf := dnfBinary(); dnf != "" {
		code, out = rootRun(10*time.Minute, 64<<10, dnf, "-y", "upgrade", name)
	} else {
		return false, "No supported package manager was found."
	}
	out = tail(out, 1500)
	if code == 0 {
		return true, out
	}
	if out == "" {
		out = fmt.Sprintf("The package manager exited %d.", code)
	}
	return false, out
}

func rootRun(limit time.Duration, max int, name string, args ...string) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = []string{"DEBIAN_FRONTEND=noninteractive", "LANG=C", "PATH=/usr/sbin:/usr/bin:/sbin:/bin"}
	var buf bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &buf, max: max}
	cmd.Stderr = cmd.Stdout
	err := cmd.Run()
	if ctx.Err() != nil {
		return 1, "The package manager timed out."
	}
	if err == nil {
		return 0, buf.String()
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode(), buf.String()
	}
	return 1, err.Error()
}

func tail(text string, max int) string {
	text = strings.TrimSpace(text)
	if len(text) > max {
		return text[len(text)-max:]
	}
	return text
}

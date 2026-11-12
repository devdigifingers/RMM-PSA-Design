//go:build windows

package main

import (
	"fmt"
	"os"
	"sync"
	"time"
)

// A short log in the user's local app data (tray.log, panel.log) so a support visit can see what the app did.
var logMu sync.Mutex

func appLog(name, format string, args ...any) {
	logMu.Lock()
	defer logMu.Unlock()
	dir := localDataDir()
	_ = os.MkdirAll(dir, 0o700)
	path := dir + `\` + name
	if info, err := os.Stat(path); err == nil && info.Size() > 256<<10 {
		_ = os.Rename(path, path+".old")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	fmt.Fprintf(file, "%s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
}

func trayLog(format string, args ...any)  { appLog("tray.log", format, args...) }
func panelLog(format string, args ...any) { appLog("panel.log", format, args...) }

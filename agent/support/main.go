//go:build windows

// DFSupport.exe is the Digital Fingers Support app. The device agent starts it in each signed-in session:
//
//	DFSupport.exe tray --key <key>   the tray icon; talks to the agent over a local pipe
//	DFSupport.exe panel              the Session Panel; started by the tray while a technician is connected
//
// The panel runs as its own process so a WebView2 failure never takes the tray down, and the tray can tell the agent
// to fall back to the connection strip.
package main

import (
	"fmt"
	"os"
)

const appVersion = "1.1.0"

func main() {
	mode := "tray"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	var err error
	switch mode {
	case "panel":
		err = runPanel()
	case "tray":
		err = runTray(argValue("--key"))
	default:
		err = fmt.Errorf("unknown mode %q", mode)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func argValue(name string) string {
	for i, arg := range os.Args {
		if arg == name && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
	}
	return ""
}

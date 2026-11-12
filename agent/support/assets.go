//go:build windows

package main

import (
	_ "embed"
	"encoding/base64"
	"strings"
)

var (
	//go:embed assets/app.ico
	appIcon []byte
	//go:embed assets/tray-idle.ico
	trayIdleIcon []byte
	//go:embed assets/tray-live.ico
	trayLiveIcon []byte
	//go:embed assets/tray-paused.ico
	trayPausedIcon []byte
	//go:embed assets/mark-96.png
	markPNG []byte
	//go:embed ui/panel.html
	panelPage string
)

func panelHTML() string {
	return strings.ReplaceAll(panelPage, "{{MARK}}", "data:image/png;base64,"+base64.StdEncoding.EncodeToString(markPNG))
}

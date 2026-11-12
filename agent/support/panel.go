//go:build windows

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"reflect"
	"sync"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/pkg/edge"
)

const (
	panelWidth     = 340
	collapsedWidth = 56
	collapsedTall  = 132
	panelMargin    = 12
)

// The panel talks to its tray over stdin and stdout, one JSON object per line.
type panelLink struct {
	sync.Mutex
	out *json.Encoder
}

func (link *panelLink) send(message map[string]any) {
	link.Lock()
	defer link.Unlock()
	_ = link.out.Encode(message)
}

type panelPlace struct {
	At float64 `json:"at"`
}

func placeFile() string { return localDataDir() + `\panel.json` }

func loadPlace() float64 {
	saved := panelPlace{At: -1}
	if raw, err := os.ReadFile(placeFile()); err == nil {
		_ = json.Unmarshal(raw, &saved)
	}
	return saved.At
}

func savePlace(at float64) {
	if raw, err := json.Marshal(panelPlace{At: at}); err == nil {
		_ = os.WriteFile(placeFile(), raw, 0o600)
	}
}

// chromiumOf reaches the library's WebView2 host, which it doesn't export; nil if the library's layout changes.
func chromiumOf(view webview2.WebView) *edge.Chromium {
	value := reflect.ValueOf(view)
	if value.Kind() != reflect.Pointer || value.Elem().Kind() != reflect.Struct {
		return nil
	}
	field := value.Elem().FieldByName("browser")
	if !field.IsValid() || !field.CanAddr() {
		return nil
	}
	chromium, _ := reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Interface().(*edge.Chromium)
	return chromium
}

// safeLink allows what the panel may open: phone and email links, and web links the technician sent in the chat.
func safeLink(target string) bool {
	if len(target) > 2048 || strings.ContainsAny(target, "\"\r\n\t ") {
		return false
	}
	lower := strings.ToLower(target)
	for _, prefix := range []string{"tel:", "mailto:", "https://", "http://"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func runPanel() error {
	dpiAware()
	link := &panelLink{out: json.NewEncoder(os.Stdout)}
	_ = os.MkdirAll(localDataDir(), 0o700)
	// The panel stayed blank on POS-3316E-Setup while its page ran: software rendering avoids old Intel graphics, and
	// Chromium's occlusion check otherwise stops drawing a topmost popup it wrongly thinks is covered.
	_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
		"--disable-gpu --disable-gpu-compositing --disable-features=CalculateNativeWinOcclusion,CalculateWindowOcclusion")
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: false,
		DataPath:  localDataDir() + `\WebView2`,
		WindowOptions: webview2.WindowOptions{
			Title:  "Digital Fingers Remote Support",
			Width:  panelWidth,
			Height: 360,
		},
	})
	if view == nil {
		panelLog("WebView2 could not start")
		link.send(map[string]any{"t": "failed", "detail": "WebView2 could not start"})
		os.Exit(3)
	}
	defer view.Destroy()
	hwnd := uintptr(view.Window())
	hidden := hideFromCapture(hwnd, true)
	makePanelWindow(hwnd)
	setWindowIcon(hwnd, appIcon)

	// Only touched on the window's thread: Bind callbacks, Dispatch and the window procedure.
	height, collapsed, at := 360, false, loadPlace()
	loaded, lastState := false, ""
	var pendingChat []string
	chromium := chromiumOf(view)
	if chromium == nil {
		panelLog("can't reach the WebView2 host; the page may stay hidden")
	}
	// On POS-3316E-Setup WebView2 left its windows hidden inside the shown panel, so the panel was blank: show and
	// size them every time the panel is placed.
	place := func() {
		if collapsed {
			dock(hwnd, collapsedWidth, collapsedTall, 0, at)
		} else {
			dock(hwnd, panelWidth, height, panelMargin, at)
		}
		if chromium != nil {
			_ = chromium.Show()
			chromium.Resize()
		}
	}
	place()
	subclass(hwnd, windowHooks{
		close: func() { view.Eval("window.dfAskEnd && window.dfAskEnd()") },
		moved: func() {
			at = dockedAt(hwnd)
			savePlace(at)
		},
		rescale: place,
	})

	_ = view.Bind("dfSend", func(raw string) {
		var message map[string]any
		if json.Unmarshal([]byte(raw), &message) != nil {
			return
		}
		switch message["t"] {
		case "size":
			if h, ok := message["h"].(float64); ok && h >= 120 && h <= 2000 && int(h) != height {
				height = int(h)
				if !collapsed {
					place()
				}
			}
		case "collapse":
			collapsed = message["on"] == true
			place()
		case "drag":
			startDrag(hwnd)
		case "ready":
			panelLog("panel %s shown (hidden from capture: %t)", appVersion, hidden)
			loaded = true
			go func() {
				for _, wait := range []time.Duration{2 * time.Second, 10 * time.Second} {
					wait := wait
					time.Sleep(wait)
					view.Dispatch(func() { panelLog("after %s (hidden from capture: %t): %s", wait, hidden, describeWindow(hwnd)) })
				}
			}()
			place()
			if lastState != "" {
				view.Eval("window.dfState(" + lastState + ")")
			}
			for _, chat := range pendingChat {
				view.Eval("window.dfChat(" + chat + ")")
			}
			pendingChat = nil
			link.send(map[string]any{"t": "opened", "hiddenFromCapture": hidden})
		case "link":
			if target, ok := message["href"].(string); ok && safeLink(target) {
				openLink(target)
			}
		case "event", "chat", "chatTyping", "chatRead":
			link.send(message)
		}
	})
	view.SetHtml(panelHTML())

	go func() {
		reader := bufio.NewReaderSize(os.Stdin, 64<<10)
		for {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				view.Dispatch(view.Terminate)
				return
			}
			var message map[string]any
			if json.Unmarshal(line, &message) != nil {
				continue
			}
			payload := strings.TrimSpace(string(line))
			switch message["t"] {
			case "close":
				view.Dispatch(view.Terminate)
				return
			case "show":
				view.Dispatch(func() {
					collapsed = false
					view.Eval("window.dfExpand && window.dfExpand()")
					place()
					bringForward(hwnd)
				})
			case "state":
				show := false
				if session, ok := message["session"].(map[string]any); ok {
					show, _ = session["showToTechnician"].(bool)
				}
				view.Dispatch(func() {
					hidden = hideFromCapture(hwnd, !show) && !show
					lastState = payload
					if loaded {
						view.Eval("window.dfState(" + payload + ")")
					}
				})
			case "link":
				up := message["up"] == true
				view.Dispatch(func() {
					if loaded {
						view.Eval(fmt.Sprintf("window.dfLink(%t)", up))
					}
				})
			case "result":
				view.Dispatch(func() { view.Eval("window.dfResult && window.dfResult(" + payload + ")") })
			case "chat":
				view.Dispatch(func() {
					if loaded {
						view.Eval("window.dfChat(" + payload + ")")
					} else {
						pendingChat = append(pendingChat, payload)
					}
				})
			case "chatResult":
				view.Dispatch(func() { view.Eval("window.dfChatResult && window.dfChatResult(" + payload + ")") })
			}
		}
	}()
	view.Run()
	return nil
}

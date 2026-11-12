//go:build windows

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"fyne.io/systray"
	"golang.org/x/sys/windows"
)

const agentPipeName = `\\.\pipe\DigitalFingersSupport`

// agentPipe is the tray's connection to the agent service. One request at a time; each gets one JSON line back.
type agentPipe struct {
	sync.Mutex
	file   *os.File
	reader *bufio.Reader
}

func dialAgent(key string) (*agentPipe, error) {
	name, _ := windows.UTF16PtrFromString(agentPipeName)
	// GENERIC_WRITE would include FILE_APPEND_DATA (create a pipe instance), which the agent's pipe denies users.
	handle, err := windows.CreateFile(name, windows.GENERIC_READ|windows.FILE_WRITE_DATA, 0, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return nil, err
	}
	pipe := &agentPipe{file: os.NewFile(uintptr(handle), agentPipeName)}
	pipe.reader = bufio.NewReaderSize(pipe.file, 64<<10)
	reply, err := pipe.call(map[string]any{"op": "hello", "key": key})
	if err != nil {
		pipe.file.Close()
		return nil, err
	}
	if reply["ok"] != true {
		pipe.file.Close()
		return nil, errors.New("the agent did not accept this tray")
	}
	return pipe, nil
}

func (pipe *agentPipe) call(request map[string]any) (map[string]any, error) {
	pipe.Lock()
	defer pipe.Unlock()
	if err := json.NewEncoder(pipe.file).Encode(request); err != nil {
		return nil, err
	}
	line, err := pipe.reader.ReadBytes('\n')
	if err != nil {
		return nil, err
	}
	var reply map[string]any
	if err := json.Unmarshal(line, &reply); err != nil {
		return nil, err
	}
	return reply, nil
}

func (pipe *agentPipe) close() { pipe.file.Close() }

// panelChild is a running Session Panel process for one remote session.
type panelChild struct {
	session int64
	cmd     *exec.Cmd
	in      io.WriteCloser
	mu      sync.Mutex
	opened  bool
	closing bool
	last    []byte
}

func (child *panelChild) send(message map[string]any) {
	raw, err := json.Marshal(message)
	if err != nil {
		return
	}
	child.write(raw)
}

func (child *panelChild) write(raw []byte) {
	child.mu.Lock()
	defer child.mu.Unlock()
	_, _ = child.in.Write(append(raw, '\n'))
}

func (child *panelChild) stop() {
	child.mu.Lock()
	child.closing = true
	child.mu.Unlock()
	child.send(map[string]any{"t": "close"})
}

type tray struct {
	key        string
	mu         sync.Mutex
	pipe       *agentPipe
	panel      *panelChild
	failedFor  int64
	crashes    map[int64]int
	lastSeen   time.Time
	linkDown   bool
	status     string
	iconReady  bool
	openItem   *systray.MenuItem
	phoneItem  *systray.MenuItem
	emailItem  *systray.MenuItem
	company    string
	phone      string
	email      string
	technician string
	unread     int
	chat       trayChat
}

// trayChat is the session's conversation as this tray has it from the agent. read is how far the customer has
// read in the panel; theirRead how far the technician has.
type trayChat struct {
	session   int64
	on        bool
	after     int64
	messages  []json.RawMessage
	fromTech  []int64
	typing    bool
	theirRead int64
	read      int64
}

type chatHeader struct {
	ID   int64  `json:"id"`
	From string `json:"from"`
}

func runTray(key string) error {
	if len(key) != 48 {
		return errors.New("DFSupport.exe is started by the Digital Fingers agent")
	}
	dpiAware()
	if !singleInstance("DigitalFingersSupportTray") {
		return nil
	}
	var session uint32
	_ = windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &session)
	trayLog("tray %s starting in Windows session %d", appVersion, session)
	app := &tray{key: key, crashes: map[int64]int{}}
	// The panel doesn't need the tray icon: on kiosk and till computers whose shell is an app instead of Explorer
	// there is no taskbar, so the session state is followed from the start and the icon is added if a taskbar
	// appears.
	go app.loop()
	if !waitForTaskbar(20 * time.Second) {
		trayLog("no taskbar in this session; the panel still shows, without a tray icon")
		for !waitForTaskbar(time.Hour) {
		}
		trayLog("a taskbar appeared")
	}
	time.Sleep(2 * time.Second)
	// systray never calls ready when adding the icon fails, and would idle without an icon or a panel; exiting
	// lets the agent start a new tray.
	started := make(chan struct{})
	go func() {
		select {
		case <-started:
		case <-time.After(30 * time.Second):
			trayLog("the tray icon could not be added; exiting so the agent starts a new tray")
			os.Exit(4)
		}
	}()
	systray.Run(func() { close(started); app.ready() }, app.exit)
	return nil
}

func (app *tray) ready() {
	trayLog("tray icon added")
	systray.SetIcon(trayIdleIcon)
	systray.SetTitle("Digital Fingers Support")
	systray.SetTooltip("Digital Fingers Support: ready")
	app.openItem = systray.AddMenuItem("Open support panel", "Show the Session Panel")
	app.openItem.Hide()
	systray.AddSeparator()
	app.phoneItem = systray.AddMenuItem("", "Call support")
	app.phoneItem.Hide()
	app.emailItem = systray.AddMenuItem("", "Email support")
	app.emailItem.Hide()
	about := systray.AddMenuItem("About Digital Fingers Support", "")
	app.mu.Lock()
	app.iconReady = true
	app.status = "unset"
	app.mu.Unlock()
	go func() {
		for {
			select {
			case <-app.openItem.ClickedCh:
				app.openPanel()
			case <-app.phoneItem.ClickedCh:
				app.mu.Lock()
				phone := app.phone
				app.mu.Unlock()
				if phone != "" {
					openLink("tel:" + phone)
				}
			case <-app.emailItem.ClickedCh:
				app.mu.Lock()
				email := app.email
				app.mu.Unlock()
				if email != "" {
					openLink("mailto:" + email)
				}
			case <-about.ClickedCh:
				go app.about()
			}
		}
	}()
}

func (app *tray) exit() {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.panel != nil {
		app.panel.stop()
	}
}

func (app *tray) about() {
	app.mu.Lock()
	company, phone, email := app.company, app.phone, app.email
	app.mu.Unlock()
	text := "Digital Fingers Support " + appVersion + "\n\nThis app shows you when a technician is connected to this computer, and lets you pause or end the session."
	if company != "" {
		text += "\n\nSupport is provided by " + company + "."
	}
	if phone != "" {
		text += "\nPhone: " + phone
	}
	if email != "" {
		text += "\nEmail: " + email
	}
	message("About Digital Fingers Support", text)
}

func (app *tray) openPanel() {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.panel != nil {
		app.panel.send(map[string]any{"t": "show"})
	}
}

// loop keeps the agent connection and polls it once a second; the agent knows whether a session is live.
func (app *tray) loop() {
	for {
		app.mu.Lock()
		pipe := app.pipe
		app.mu.Unlock()
		if pipe == nil {
			next, err := dialAgent(app.key)
			if err != nil {
				if !app.linkDown {
					trayLog("can't reach the agent: %v", err)
				}
				app.setLink(false)
				app.disconnected()
				time.Sleep(3 * time.Second)
				continue
			}
			app.mu.Lock()
			app.pipe = next
			app.mu.Unlock()
			pipe = next
			trayLog("connected to the agent")
		}
		app.mu.Lock()
		after := app.chat.after
		app.mu.Unlock()
		reply, err := pipe.call(map[string]any{"op": "state", "chatAfter": after})
		if err != nil {
			trayLog("agent connection lost: %v", err)
			pipe.close()
			app.mu.Lock()
			app.pipe = nil
			app.mu.Unlock()
			continue
		}
		app.lastSeen = time.Now()
		app.setLink(true)
		if reply["exit"] == true {
			trayLog("the agent says this computer is silent; exiting")
			systray.Quit()
			return
		}
		app.apply(reply)
		time.Sleep(time.Second)
	}
}

// setLink tells an open panel when the agent connection drops and comes back, so it can show "Reconnecting".
func (app *tray) setLink(up bool) {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.linkDown == !up {
		return
	}
	app.linkDown = !up
	if app.panel != nil {
		app.panel.send(map[string]any{"t": "link", "up": up})
	}
}

// disconnected closes the panel once the agent has been away for a while; a short gap is usually an agent update.
func (app *tray) disconnected() {
	if app.lastSeen.IsZero() || time.Since(app.lastSeen) < 30*time.Second {
		return
	}
	app.apply(map[string]any{"ok": true})
}

type sessionKeys struct {
	ID         int64 `json:"id"`
	Paused     bool  `json:"paused"`
	Technician struct {
		Name string `json:"name"`
	} `json:"technician"`
}

func (app *tray) apply(reply map[string]any) {
	text := func(key string) string { value, _ := reply[key].(string); return value }
	var keys sessionKeys
	var raw []byte
	if session, ok := reply["session"]; ok && session != nil {
		raw, _ = json.Marshal(session)
		_ = json.Unmarshal(raw, &keys)
	}

	app.mu.Lock()
	defer app.mu.Unlock()
	app.company, app.phone, app.email = text("company"), text("phone"), text("email")
	app.setContact(app.phoneItem, app.phone, "Call ")
	app.setContact(app.emailItem, app.email, "Email ")

	fresh, chatChanged := app.takeChat(keys.ID, reply["chat"])
	if keys.ID == 0 {
		if app.status != "idle" && app.status != "" {
			trayLog("no live session")
		}
		app.setStatus("idle", "")
		if app.panel != nil {
			app.panel.stop()
			app.panel = nil
		}
		app.showOpen(false)
		return
	}
	if app.status == "idle" || app.status == "" {
		trayLog("live session %d", keys.ID)
	}
	if keys.Paused {
		app.setStatus("paused", keys.Technician.Name)
	} else {
		app.setStatus("live", keys.Technician.Name)
	}
	if app.panel != nil && app.panel.session != keys.ID {
		app.panel.stop()
		app.panel = nil
	}
	started := false
	if app.panel == nil && app.failedFor != keys.ID {
		if err := app.startPanel(keys.ID); err != nil {
			trayLog("panel could not start: %v", err)
			app.failedFor = keys.ID
			go app.report("panel.failed", err.Error(), keys.ID)
		} else {
			started = true
		}
	}
	if app.panel == nil {
		app.showOpen(false)
		return
	}
	app.showOpen(true)
	if app.chat.on && (started || chatChanged) {
		messages := fresh
		if started {
			messages = app.chat.messages
		}
		app.panel.send(map[string]any{"t": "chat", "messages": messages, "typing": app.chat.typing, "read": app.chat.theirRead})
	}
	state, _ := json.Marshal(map[string]any{"t": "state", "session": json.RawMessage(raw), "company": app.company, "phone": app.phone, "email": app.email})
	if !bytes.Equal(state, app.panel.last) {
		app.panel.last = state
		app.panel.write(state)
	}
}

func (app *tray) showOpen(on bool) {
	if !app.iconReady {
		return
	}
	if on {
		app.openItem.Show()
	} else {
		app.openItem.Hide()
	}
}

func (app *tray) setContact(item *systray.MenuItem, value, label string) {
	if !app.iconReady {
		return
	}
	if value == "" {
		item.Hide()
		return
	}
	item.SetTitle(label + value)
	item.Show()
}

// setStatus updates the tray icon and tooltip, with the number of technician messages the customer hasn't read;
// the caller holds app.mu.
func (app *tray) setStatus(status, technician string) {
	unread := app.unreadCount()
	if status == app.status && technician == app.technician && unread == app.unread {
		return
	}
	app.status, app.technician, app.unread = status, technician, unread
	if !app.iconReady {
		return
	}
	name, icon, tip := "idle", trayIdleIcon, "Digital Fingers Support: ready"
	switch status {
	case "live":
		name, icon, tip = "live", trayLiveIcon, "Digital Fingers Support: connected to "+technician
	case "paused":
		name, icon, tip = "paused", trayPausedIcon, "Digital Fingers Support: paused ("+technician+")"
	}
	if unread == 1 {
		tip = "1 new message · " + tip
	} else if unread > 1 {
		tip = fmt.Sprintf("%d new messages · %s", unread, tip)
	}
	systray.SetIcon(badgeIcon(name, icon, unread))
	systray.SetTooltip(clipTip(tip))
}

func (app *tray) unreadCount() int {
	count := 0
	for _, id := range app.chat.fromTech {
		if id > app.chat.read {
			count++
		}
	}
	return count
}

// takeChat adds what the agent sent since the last poll; the caller holds app.mu. It returns the new messages and
// whether the panel needs an update.
func (app *tray) takeChat(session int64, raw any) ([]json.RawMessage, bool) {
	if session != app.chat.session {
		app.chat = trayChat{session: session}
	}
	if session == 0 || raw == nil {
		return nil, false
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	var view struct {
		Messages []json.RawMessage `json:"messages"`
		Typing   bool              `json:"typing"`
		Read     int64             `json:"read"`
	}
	if json.Unmarshal(encoded, &view) != nil {
		return nil, false
	}
	changed := !app.chat.on || view.Typing != app.chat.typing || view.Read != app.chat.theirRead
	app.chat.on = true
	app.chat.typing, app.chat.theirRead = view.Typing, view.Read
	var fresh []json.RawMessage
	for _, message := range view.Messages {
		var head chatHeader
		if json.Unmarshal(message, &head) != nil || head.ID <= app.chat.after {
			continue
		}
		app.chat.after = head.ID
		app.chat.messages = append(app.chat.messages, message)
		if head.From == "technician" {
			app.chat.fromTech = append(app.chat.fromTech, head.ID)
		}
		fresh = append(fresh, message)
	}
	if extra := len(app.chat.messages) - 500; extra > 0 {
		app.chat.messages = append([]json.RawMessage(nil), app.chat.messages[extra:]...)
	}
	return fresh, changed || len(fresh) > 0
}

// chatFromPanel passes what the customer did in the chat to the agent: a message, typing, or reading up to an id.
func (app *tray) chatFromPanel(child *panelChild, message map[string]any) {
	request := map[string]any{"op": "chat", "sessionId": child.session}
	switch message["t"] {
	case "chat":
		text, _ := message["text"].(string)
		request["text"] = text
	case "chatTyping":
		request["typing"] = message["on"] == true
	case "chatRead":
		id, _ := message["id"].(float64)
		if id <= 0 {
			return
		}
		app.mu.Lock()
		if app.chat.session == child.session && int64(id) > app.chat.read {
			app.chat.read = int64(id)
			app.setStatus(app.status, app.technician)
		}
		app.mu.Unlock()
		request["read"] = int64(id)
	default:
		return
	}
	app.mu.Lock()
	pipe := app.pipe
	app.mu.Unlock()
	reply := map[string]any{"ok": false, "error": "The Digital Fingers agent is not running."}
	if pipe != nil {
		if answer, err := pipe.call(request); err == nil {
			reply = answer
		}
	}
	if message["t"] == "chat" {
		if reply["ok"] != true {
			trayLog("chat message not sent: %v", reply["error"])
		}
		child.send(map[string]any{"t": "chatResult", "ok": reply["ok"] == true, "error": reply["error"], "message": reply["message"]})
	}
}

// Tray tooltips are limited to 127 characters.
func clipTip(text string) string {
	runes := []rune(text)
	if len(runes) > 120 {
		return string(runes[:119]) + "…"
	}
	return text
}

func (app *tray) report(kind, detail string, session int64) map[string]any {
	app.mu.Lock()
	pipe := app.pipe
	app.mu.Unlock()
	if pipe == nil {
		return map[string]any{"ok": false, "error": "The Digital Fingers agent is not running."}
	}
	request := map[string]any{"op": "event", "type": kind, "detail": detail}
	if session > 0 {
		request["sessionId"] = session
	}
	reply, err := pipe.call(request)
	if err != nil {
		trayLog("%s not sent: %v", kind, err)
		return map[string]any{"ok": false, "error": "The Digital Fingers agent is not running."}
	}
	trayLog("%s sent: %v", kind, reply["ok"])
	return reply
}

// panelErrors copies anything the panel prints on stderr (a crash, for example) into the tray log.
type panelErrors struct{}

func (panelErrors) Write(p []byte) (int, error) {
	trayLog("panel: %s", strings.TrimSpace(string(p)))
	return len(p), nil
}

// startPanel runs the Session Panel as a child process; the caller holds app.mu.
func (app *tray) startPanel(session int64) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(self, "panel")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Stderr = panelErrors{}
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("the panel could not start: %w", err)
	}
	trayLog("panel started for session %d (pid %d)", session, cmd.Process.Pid)
	child := &panelChild{session: session, cmd: cmd, in: in}
	app.panel = child
	go app.watchPanel(child, out)
	return nil
}

func (app *tray) watchPanel(child *panelChild, out io.Reader) {
	reader := bufio.NewReaderSize(out, 64<<10)
	failure := ""
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			break
		}
		var message map[string]any
		if json.Unmarshal(line, &message) != nil {
			continue
		}
		switch message["t"] {
		case "opened":
			child.mu.Lock()
			first := !child.opened
			child.opened = true
			child.mu.Unlock()
			if first {
				detail := ""
				if message["hiddenFromCapture"] == false {
					detail = "Shown to the technician"
				}
				go app.report("panel.opened", detail, child.session)
			}
		case "failed":
			failure, _ = message["detail"].(string)
		case "chat", "chatTyping", "chatRead":
			go app.chatFromPanel(child, message)
		case "event":
			kind, _ := message["type"].(string)
			if kind != "session.pause" && kind != "session.resume" && kind != "session.end" {
				continue
			}
			go func() {
				reply := app.report(kind, "", child.session)
				child.send(map[string]any{"t": "result", "type": kind, "ok": reply["ok"] == true, "error": reply["error"]})
			}()
		}
	}
	err := child.cmd.Wait()
	trayLog("panel for session %d exited: %v %s", child.session, err, failure)

	app.mu.Lock()
	defer app.mu.Unlock()
	if app.panel == child {
		app.panel = nil
	}
	child.mu.Lock()
	opened, closing := child.opened, child.closing
	child.mu.Unlock()
	if closing {
		return
	}
	// A panel that never opened, or keeps crashing, falls back to the connection strip.
	app.crashes[child.session]++
	if opened && app.crashes[child.session] < 3 {
		return
	}
	if failure == "" {
		failure = "The panel closed unexpectedly"
		if err != nil {
			failure += ": " + err.Error()
		}
	}
	app.failedFor = child.session
	go app.report("panel.failed", failure, child.session)
}

//go:build windows

package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The Digital Fingers Support app (DFSupport.exe) shows the tray icon in every signed-in session and the Session
// Panel while a technician is connected. It runs as the user, so it lives in Program Files where users can run it
// but not change it, and it reaches the agent only through a local named pipe.
const supportPipeName = `\\.\pipe\DigitalFingersSupport`

// SYSTEM and Administrators have full access; interactive users may connect, read and write, but not create pipe
// instances (FILE_APPEND_DATA), so no user process can pose as the agent.
const supportPipeSDDL = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x12018b;;;IU)"

const pipeRejectRemoteClients = 0x8

var supportExe = filepath.Join(programFilesDir(), "Digital Fingers", "Support", "DFSupport.exe")

func programFilesDir() string {
	if dir := os.Getenv("ProgramFiles"); dir != "" {
		return dir
	}
	return `C:\Program Files`
}

type traySlot struct {
	key      string
	launched time.Time
	tries    int
}

var support = struct {
	sync.Mutex
	api       string
	state     savedState
	trays     map[uint32]*traySlot
	failedAt  time.Time
	detail    string
	installed string

	webView2Busy  bool
	webView2Tried time.Time
}{trays: map[uint32]*traySlot{}}

func supportLoop(ctx context.Context, api string, state savedState) {
	support.Lock()
	support.api = api
	support.state = state
	support.Unlock()
	go supportPipeServer(ctx)
	var lastPoll, lastInstall time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
		info := supportLatest.Load()
		if info == nil {
			continue
		}
		_, live := info.liveSession()
		if live && time.Since(lastPoll) >= 3*time.Second {
			lastPoll = time.Now()
			if next, err := fetchSupportState(api, state); err == nil {
				supportLatest.Store(next)
				info = next
				_, live = info.liveSession()
			}
		}
		if time.Since(lastInstall) >= time.Minute {
			lastInstall = time.Now()
			if err := ensureSupportApp(ctx, api, state, info.SHA256, live); err != nil {
				fmt.Fprintln(os.Stderr, "support app:", err)
			}
			ensureWebView2(ctx, info, live)
		}
		keepTrays(info)
	}
}

// supportReport tells the server whether this computer can show the Session Panel; the server keeps the
// connection strip on every device that can't.
func supportReport() map[string]string {
	info := supportLatest.Load()
	support.Lock()
	failedAt, detail, installed := support.failedAt, support.detail, support.installed
	support.Unlock()
	switch {
	case info != nil && info.Silent:
		return map[string]string{"state": "silent"}
	case info == nil || info.SHA256 == "" || !strings.EqualFold(installed, info.SHA256):
		return map[string]string{"state": "not-installed"}
	case !webView2Installed():
		return map[string]string{"state": "no-webview2"}
	case !failedAt.IsZero() && time.Since(failedAt) < time.Hour:
		return map[string]string{"state": "failed", "detail": detail}
	}
	return map[string]string{"state": "ready"}
}

func webView2Installed() bool {
	const client = `Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
	for _, path := range []string{`SOFTWARE\WOW6432Node\` + client, `SOFTWARE\` + client} {
		if version := registryString(path, "pv"); version != "" && version != "0.0.0.0" {
			return true
		}
	}
	found, _ := filepath.Glob(filepath.Join(programFilesX86Dir(), "Microsoft", "EdgeWebView", "Application", "*", "msedgewebview2.exe"))
	return len(found) > 0
}

func programFilesX86Dir() string {
	if dir := os.Getenv("ProgramFiles(x86)"); dir != "" {
		return dir
	}
	return `C:\Program Files (x86)`
}

// Microsoft's Evergreen bootstrapper; run as SYSTEM it installs the WebView2 runtime for all users.
const webView2Bootstrapper = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

// ensureWebView2 installs the WebView2 runtime the Session Panel needs, at most once every 6 hours, only for
// tenants that show the panel, and never during a session. It runs in the background: the install takes minutes.
func ensureWebView2(ctx context.Context, info *supportInfo, live bool) {
	if !info.Panel || info.Silent || live {
		return
	}
	support.Lock()
	busy := support.webView2Busy || time.Since(support.webView2Tried) < 6*time.Hour
	if !busy {
		support.webView2Busy = true
		support.webView2Tried = time.Now()
	}
	support.Unlock()
	if busy || webView2Installed() {
		support.Lock()
		if !busy {
			support.webView2Busy = false
		}
		support.Unlock()
		return
	}
	go func() {
		defer func() {
			support.Lock()
			support.webView2Busy = false
			support.Unlock()
		}()
		if err := installWebView2(ctx); err != nil {
			fmt.Fprintln(os.Stderr, "webview2:", err)
		}
	}()
}

func installWebView2(ctx context.Context) error {
	dir := filepath.Join(os.Getenv("ProgramData"), "DigitalFingers")
	if os.Getenv("ProgramData") == "" {
		dir = `C:\ProgramData\DigitalFingers`
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	setup := filepath.Join(dir, "MicrosoftEdgeWebview2Setup.exe")
	defer os.Remove(setup)
	fetch, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(fetch, http.MethodGet, webView2Bootstrapper, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download: HTTP %d", res.StatusCode)
	}
	out, err := os.OpenFile(setup, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
	if err != nil {
		return err
	}
	size, err := io.Copy(out, io.LimitReader(res.Body, 32<<20+1))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err == nil && size > 32<<20 {
		err = fmt.Errorf("the download is too large")
	}
	if err != nil {
		return err
	}
	if err := microsoftSigned(ctx, setup); err != nil {
		return err
	}
	run, stop := context.WithTimeout(ctx, 20*time.Minute)
	defer stop()
	cmd := exec.CommandContext(run, setup, "/silent", "/install")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("the WebView2 installer failed: %w", err)
	}
	if !webView2Installed() {
		return fmt.Errorf("the WebView2 installer finished but the runtime was not found")
	}
	return nil
}

// microsoftSigned checks the file has a valid Authenticode signature from Microsoft before it is run as SYSTEM.
func microsoftSigned(ctx context.Context, path string) error {
	check, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	script := "$s = Get-AuthenticodeSignature -LiteralPath $env:DF_CHECK_FILE; " +
		"if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match 'O=Microsoft Corporation') { 'signed' } else { [string]$s.Status }"
	cmd := exec.CommandContext(check, `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "DF_CHECK_FILE="+path)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("signature check: %w", err)
	}
	if result := strings.TrimSpace(string(out)); result != "signed" {
		return fmt.Errorf("the WebView2 installer is not signed by Microsoft (%s)", result)
	}
	return nil
}

func fetchSupportState(api string, state savedState) (*supportInfo, error) {
	req, err := http.NewRequest(http.MethodGet, api+"/v1/agent/support/state", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("authorization", "Device "+state.DeviceToken)
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("support state: HTTP %d", res.StatusCode)
	}
	var info supportInfo
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&info); err != nil {
		return nil, err
	}
	return &info, nil
}

// ensureSupportApp installs or replaces DFSupport.exe when the published hash differs. It is never replaced during
// a session, so an open panel is not closed under the customer.
func ensureSupportApp(ctx context.Context, api string, state savedState, want string, live bool) error {
	want = strings.ToLower(strings.TrimSpace(want))
	if len(want) != 64 {
		return nil
	}
	if fileMatches(supportExe, want) {
		support.Lock()
		support.installed = want
		support.Unlock()
		return nil
	}
	if live {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(supportExe), 0o755); err != nil {
		return err
	}
	next := supportExe + ".new"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api+"/v1/agent/support/windows", nil)
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Device "+state.DeviceToken)
	client := &http.Client{Timeout: 10 * time.Minute}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download: HTTP %d", res.StatusCode)
	}
	out, err := os.OpenFile(next, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(res.Body, 64<<20+1))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err == nil && size > 64<<20 {
		err = fmt.Errorf("the download is too large")
	}
	if err == nil && hex.EncodeToString(hash.Sum(nil)) != want {
		err = fmt.Errorf("the download does not match the published hash")
	}
	if err != nil {
		_ = os.Remove(next)
		return err
	}
	stopSupportApps()
	for i := 0; ; i++ {
		if err = os.Rename(next, supportExe); err == nil || i == 10 {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		_ = os.Remove(next)
		return err
	}
	support.Lock()
	support.installed = want
	for _, slot := range support.trays {
		slot.tries = 0
	}
	support.Unlock()
	fmt.Println("support app installed")
	return nil
}

// keepTrays starts the tray app in every active user session that lacks one, unless the tenant made this
// computer silent. A tray that keeps exiting is retried at most three times in ten minutes.
func keepTrays(info *supportInfo) {
	support.Lock()
	ready := support.installed != "" && strings.EqualFold(support.installed, info.SHA256)
	support.Unlock()
	if info.Silent || !ready {
		return
	}
	running := supportProcesses()
	for _, session := range activeSessions() {
		if running[session] {
			continue
		}
		support.Lock()
		slot := support.trays[session]
		if slot == nil {
			slot = &traySlot{}
			support.trays[session] = slot
		}
		if time.Since(slot.launched) > 10*time.Minute {
			slot.tries = 0
		}
		if slot.tries >= 3 || time.Since(slot.launched) < 20*time.Second {
			support.Unlock()
			continue
		}
		slot.key = randomKey()
		slot.launched = time.Now()
		slot.tries++
		key := slot.key
		support.Unlock()
		if err := launchTray(session, key); err != nil {
			fmt.Fprintf(os.Stderr, "support app session %d: %v\n", session, err)
		}
	}
}

func randomKey() string {
	raw := make([]byte, 24)
	_, _ = rand.Read(raw)
	return hex.EncodeToString(raw)
}

// activeSessions lists sessions with a signed-in user at an unlocked or locked desktop (WTSActive).
func activeSessions() []uint32 {
	var raw *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &raw, &count); err != nil || raw == nil {
		return nil
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(raw)))
	list := unsafe.Slice(raw, count)
	var out []uint32
	for _, item := range list {
		if item.SessionID == 0 || item.State != windows.WTSActive {
			continue
		}
		if sessionUserName(item.SessionID) != "" {
			out = append(out, item.SessionID)
		}
	}
	return out
}

func sessionUserName(session uint32) string {
	query := windows.NewLazySystemDLL("wtsapi32.dll").NewProc("WTSQuerySessionInformationW")
	var buf uintptr
	var size uint32
	result, _, _ := query.Call(0, uintptr(session), 5, uintptr(unsafe.Pointer(&buf)), uintptr(unsafe.Pointer(&size)))
	if result == 0 || buf == 0 {
		return ""
	}
	defer windows.WTSFreeMemory(buf)
	return strings.TrimSpace(windows.UTF16PtrToString((*uint16)(unsafe.Pointer(buf))))
}

func launchTray(session uint32, key string) error {
	var token windows.Token
	if err := windows.WTSQueryUserToken(session, &token); err != nil {
		return err
	}
	defer token.Close()
	var env *uint16
	if err := windows.CreateEnvironmentBlock(&env, token, false); err != nil {
		return err
	}
	defer windows.DestroyEnvironmentBlock(env)
	app, err := windows.UTF16PtrFromString(supportExe)
	if err != nil {
		return err
	}
	line, err := windows.UTF16PtrFromString(`"` + supportExe + `" tray --key ` + key)
	if err != nil {
		return err
	}
	dir, err := windows.UTF16PtrFromString(filepath.Dir(supportExe))
	if err != nil {
		return err
	}
	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return err
	}
	startup := windows.StartupInfo{Desktop: desktop}
	startup.Cb = uint32(unsafe.Sizeof(startup))
	var proc windows.ProcessInformation
	err = windows.CreateProcessAsUser(token, app, line, nil, nil, false,
		windows.CREATE_UNICODE_ENVIRONMENT|windows.CREATE_NEW_PROCESS_GROUP, env, dir, &startup, &proc)
	if err != nil {
		return err
	}
	windows.CloseHandle(proc.Thread)
	windows.CloseHandle(proc.Process)
	return nil
}

// supportProcesses returns the sessions that already run our DFSupport.exe (matched by full path, so a copy
// elsewhere doesn't count).
func supportProcesses() map[uint32]bool {
	out := map[uint32]bool{}
	for _, pid := range supportPids() {
		var session uint32
		if windows.ProcessIdToSessionId(pid, &session) == nil {
			out[session] = true
		}
	}
	return out
}

func supportPids() []uint32 {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	var pids []uint32
	for err = windows.Process32First(snap, &entry); err == nil; err = windows.Process32Next(snap, &entry) {
		if !strings.EqualFold(windows.UTF16ToString(entry.ExeFile[:]), "DFSupport.exe") {
			continue
		}
		if strings.EqualFold(processPath(entry.ProcessID), supportExe) {
			pids = append(pids, entry.ProcessID)
		}
	}
	return pids
}

func processPath(pid uint32) string {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(handle)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(handle, 0, &buf[0], &size); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

func stopSupportApps() {
	for _, pid := range supportPids() {
		handle, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, pid)
		if err != nil {
			continue
		}
		_ = windows.TerminateProcess(handle, 0)
		windows.CloseHandle(handle)
	}
	time.Sleep(time.Second)
}

func removeSupportApp() {
	stopSupportApps()
	_ = os.RemoveAll(filepath.Dir(supportExe))
}

func supportPipeServer(ctx context.Context) {
	sd, err := windows.SecurityDescriptorFromString(supportPipeSDDL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "support pipe:", err)
		return
	}
	attrs := &windows.SecurityAttributes{SecurityDescriptor: sd}
	attrs.Length = uint32(unsafe.Sizeof(*attrs))
	name, _ := windows.UTF16PtrFromString(supportPipeName)
	first := true
	for ctx.Err() == nil {
		flags := uint32(windows.PIPE_ACCESS_DUPLEX)
		if first {
			flags |= windows.FILE_FLAG_FIRST_PIPE_INSTANCE
		}
		handle, err := windows.CreateNamedPipe(name, flags,
			windows.PIPE_TYPE_BYTE|windows.PIPE_READMODE_BYTE|windows.PIPE_WAIT|pipeRejectRemoteClients,
			windows.PIPE_UNLIMITED_INSTANCES, 8192, 8192, 0, attrs)
		if err != nil {
			fmt.Fprintln(os.Stderr, "support pipe:", err)
			time.Sleep(30 * time.Second)
			continue
		}
		first = false
		if err := windows.ConnectNamedPipe(handle, nil); err != nil && err != windows.ERROR_PIPE_CONNECTED {
			windows.CloseHandle(handle)
			continue
		}
		go serveTray(handle)
	}
}

var getNamedPipeClientProcessId = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetNamedPipeClientProcessId")

type pipeRequest struct {
	Op        string `json:"op"`
	Key       string `json:"key"`
	Type      string `json:"type"`
	Detail    string `json:"detail"`
	SessionID int64  `json:"sessionId"`
}

// serveTray answers one tray app. The client must be our DFSupport.exe, in the session it was started in, holding
// the key it was started with. Each request gets one JSON line back.
func serveTray(handle windows.Handle) {
	file := os.NewFile(uintptr(handle), supportPipeName)
	defer file.Close()
	var pid uint32
	if ok, _, _ := getNamedPipeClientProcessId.Call(uintptr(handle), uintptr(unsafe.Pointer(&pid))); ok == 0 {
		return
	}
	var session uint32
	if windows.ProcessIdToSessionId(pid, &session) != nil || !strings.EqualFold(processPath(pid), supportExe) {
		return
	}
	reader := bufio.NewReaderSize(file, 16<<10)
	writer := json.NewEncoder(file)
	greeted := false
	for {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			return
		}
		var req pipeRequest
		if json.Unmarshal(line, &req) != nil {
			return
		}
		if !greeted {
			// After an agent restart a tray started by the previous agent is adopted with the key it holds.
			support.Lock()
			slot := support.trays[session]
			if slot == nil && req.Op == "hello" && len(req.Key) == 48 {
				slot = &traySlot{key: req.Key, launched: time.Now()}
				support.trays[session] = slot
			}
			valid := req.Op == "hello" && slot != nil && slot.key != "" && req.Key == slot.key
			if valid {
				slot.tries = 0
			}
			support.Unlock()
			if !valid {
				_ = writer.Encode(map[string]any{"ok": false})
				return
			}
			greeted = true
			if writer.Encode(map[string]any{"ok": true}) != nil {
				return
			}
			continue
		}
		var reply any
		switch req.Op {
		case "state":
			reply = trayState(session)
		case "event":
			reply = trayEvent(session, req)
		default:
			reply = map[string]any{"ok": false, "error": "unknown request"}
		}
		if writer.Encode(reply) != nil {
			return
		}
	}
}

// trayState is what one session's tray sees: the live session reaches the session the technician is viewing and
// the session at the physical screen, so whoever sits at the computer always sees it.
func trayState(session uint32) map[string]any {
	info := supportLatest.Load()
	if info == nil {
		return map[string]any{"ok": true}
	}
	out := map[string]any{
		"ok":      true,
		"exit":    info.Silent,
		"company": info.Company,
		"phone":   info.Phone,
		"email":   info.Email,
	}
	if keys, live := info.liveSession(); live && sessionSees(keys, session) {
		out["session"] = info.Session
	}
	return out
}

func sessionSees(keys supportSessionKeys, session uint32) bool {
	if keys.TSID != nil && *keys.TSID > 0 && uint32(*keys.TSID) == session {
		return true
	}
	return windows.WTSGetActiveConsoleSessionId() == session
}

func trayEvent(session uint32, req pipeRequest) map[string]any {
	support.Lock()
	api, state := support.api, support.state
	switch req.Type {
	case "panel.failed":
		support.failedAt = time.Now()
		support.detail = clip(req.Detail, 200)
	case "panel.opened":
		support.failedAt = time.Time{}
		support.detail = ""
	}
	support.Unlock()
	payload := map[string]any{"type": req.Type, "detail": clip(req.Detail, 200), "user": sessionUserName(session)}
	if req.SessionID > 0 {
		payload["sessionId"] = req.SessionID
	}
	body, err := postJSON(api+"/v1/agent/support/event", state.DeviceToken, payload)
	if err != nil {
		return map[string]any{"ok": false, "error": "The Digital Fingers server could not be reached."}
	}
	if strings.HasPrefix(req.Type, "session.") {
		var next supportInfo
		if json.Unmarshal(body, &next) == nil {
			supportLatest.Store(&next)
		}
	}
	return map[string]any{"ok": true}
}

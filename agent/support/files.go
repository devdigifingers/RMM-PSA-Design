//go:build windows

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// Session Panel files on the tray side. The tray runs as the signed-in user, so files the customer accepts are
// written with the customer's own rights, to Downloads\Digital Fingers\<date>, checked against the SHA-256 the
// server recorded and marked as downloaded from the internet so Windows SmartScreen still checks programs.

type trayFiles struct {
	session int64
	byID    map[int64]trayFile
	saved   map[int64]string
	saving  map[int64]bool
	offers  int
	last    []byte
}

type trayFile struct {
	ID        int64  `json:"id"`
	Direction string `json:"direction"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
	Status    string `json:"status"`
	Ready     bool   `json:"ready"`
}

// takeFiles keeps the session's file list from the agent and returns the panel message when it changed; the caller
// holds app.mu.
func (app *tray) takeFiles(session int64, raw any) []byte {
	if session != app.files.session || app.files.byID == nil {
		app.files = trayFiles{session: session, byID: map[int64]trayFile{}, saved: map[int64]string{}, saving: map[int64]bool{}}
	}
	if session == 0 || raw == nil {
		return nil
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var items []map[string]any
	var files []trayFile
	if json.Unmarshal(encoded, &items) != nil || json.Unmarshal(encoded, &files) != nil || len(items) != len(files) {
		return nil
	}
	app.files.byID = map[int64]trayFile{}
	app.files.offers = 0
	for i, file := range files {
		app.files.byID[file.ID] = file
		if path := app.files.saved[file.ID]; path != "" {
			items[i]["saved"] = filepath.Base(path)
		} else if app.files.saving[file.ID] {
			items[i]["saving"] = true
		} else if file.Direction == "to_customer" && file.Status == "offered" && file.Ready {
			app.files.offers++
		}
	}
	message, _ := json.Marshal(map[string]any{"t": "files", "files": items})
	if bytes.Equal(message, app.files.last) {
		return nil
	}
	app.files.last = message
	return message
}

// fileFromPanel passes an offer, a chunk, a cancel or a decline from the panel to the agent and answers the panel.
func (app *tray) fileFromPanel(child *panelChild, message map[string]any) {
	kind, _ := message["t"].(string)
	request := map[string]any{"op": kind, "sessionId": child.session}
	for _, key := range []string{"fileId", "offset", "data", "name", "size"} {
		if value, ok := message[key]; ok {
			request[key] = value
		}
	}
	if value, ok := message["type"].(string); ok {
		request["contentType"] = value
	}
	reply := app.callAgent(request)
	if kind != "fileChunk" && reply["ok"] != true {
		trayLog("%s: %v", kind, reply["error"])
	}
	reply["t"] = "fileResult"
	reply["ref"] = message["ref"]
	child.send(reply)
}

func (app *tray) callAgent(request map[string]any) map[string]any {
	app.mu.Lock()
	pipe := app.pipe
	app.mu.Unlock()
	if pipe == nil {
		return map[string]any{"ok": false, "error": "The Digital Fingers agent is not running."}
	}
	reply, err := pipe.call(request)
	if err != nil {
		return map[string]any{"ok": false, "error": "The Digital Fingers agent is not running."}
	}
	return reply
}

// saveFile saves a file the customer accepted, reading it from the agent in chunks.
func (app *tray) saveFile(child *panelChild, message map[string]any) {
	ref := message["ref"]
	id := int64(numberOf(message["fileId"]))
	answer := func(ok bool, text, name string) {
		reply := map[string]any{"t": "fileResult", "ref": ref, "ok": ok, "fileId": id}
		if text != "" {
			reply["error"] = text
		}
		if name != "" {
			reply["name"] = name
		}
		child.send(reply)
	}
	app.mu.Lock()
	file, known := app.files.byID[id]
	busy := app.files.saving[id] || app.files.saved[id] != ""
	if known && !busy && app.files.session == child.session {
		app.files.saving[id] = true
	}
	app.mu.Unlock()
	if !known || busy || file.Direction != "to_customer" || file.Status != "offered" || !file.Ready {
		answer(false, "That file is no longer offered.", "")
		return
	}
	path, err := app.writeFile(child, file)
	app.mu.Lock()
	delete(app.files.saving, id)
	if err == nil {
		app.files.saved[id] = path
	}
	app.files.last = nil
	app.mu.Unlock()
	if err != nil {
		trayLog("file %d not saved: %v", id, err)
		app.callAgent(map[string]any{"op": "fileError", "sessionId": child.session, "fileId": id, "detail": "It could not be saved on the computer."})
		answer(false, "The file could not be saved. Your technician has been told.", "")
		return
	}
	trayLog("file %d saved (%d bytes)", id, file.Size)
	app.callAgent(map[string]any{"op": "fileAccept", "sessionId": child.session, "fileId": id})
	answer(true, "", filepath.Base(path))
}

func (app *tray) writeFile(child *panelChild, file trayFile) (string, error) {
	path, err := saveTarget(file.Name)
	if err != nil {
		return "", err
	}
	out, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	fail := func(err error) (string, error) {
		out.Close()
		_ = os.Remove(path)
		return "", err
	}
	hash := sha256.New()
	var offset, reported int64
	for offset < file.Size {
		reply := app.callAgent(map[string]any{"op": "fileRead", "sessionId": child.session, "fileId": file.ID, "offset": offset})
		if reply["ok"] != true {
			return fail(fmt.Errorf("%v", reply["error"]))
		}
		encoded, _ := reply["data"].(string)
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return fail(err)
		}
		if len(data) == 0 || offset+int64(len(data)) > file.Size {
			break
		}
		if _, err := out.Write(data); err != nil {
			return fail(err)
		}
		hash.Write(data)
		offset += int64(len(data))
		if offset-reported >= 512<<10 || offset == file.Size {
			reported = offset
			child.send(map[string]any{"t": "fileProgress", "fileId": file.ID, "done": offset, "size": file.Size})
		}
	}
	if offset != file.Size || !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), file.SHA256) {
		return fail(fmt.Errorf("the file didn't arrive complete"))
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	_ = os.WriteFile(path+":Zone.Identifier", []byte("[ZoneTransfer]\r\nZoneId=3\r\n"), 0o644)
	return path, nil
}

// saveTarget is a free name in Downloads\Digital Fingers\<date>.
func saveTarget(name string) (string, error) {
	downloads, err := windows.KnownFolderPath(windows.FOLDERID_Downloads, 0)
	if err != nil || downloads == "" {
		downloads = filepath.Join(os.Getenv("USERPROFILE"), "Downloads")
	}
	dir := filepath.Join(downloads, "Digital Fingers", time.Now().Format("2006-01-02"))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := safeFileName(name)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for i := 1; i < 1000; i++ {
		candidate := base
		if i > 1 {
			candidate = fmt.Sprintf("%s (%d)%s", stem, i, ext)
		}
		if _, err := os.Lstat(filepath.Join(dir, candidate)); os.IsNotExist(err) {
			return filepath.Join(dir, candidate), nil
		}
	}
	return "", fmt.Errorf("too many files called %s", base)
}

func safeFileName(name string) string {
	name = name[strings.LastIndexAny(name, `\/`)+1:]
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || strings.ContainsRune(`<>:"|?*`, r) {
			return -1
		}
		return r
	}, name)
	name = strings.Trim(name, ". ")
	if name == "" {
		return "file"
	}
	stem := strings.ToLower(strings.SplitN(name, ".", 2)[0])
	switch stem {
	case "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
		"lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9":
		name = "_" + name
	}
	if runes := []rune(name); len(runes) > 180 {
		ext := filepath.Ext(name)
		if len([]rune(ext)) > 12 {
			ext = ""
		}
		name = string(runes[:180-len([]rune(ext))]) + ext
	}
	return name
}

// openSaved shows a saved file in Explorer.
func (app *tray) openSaved(message map[string]any) {
	id := int64(numberOf(message["fileId"]))
	app.mu.Lock()
	path := app.files.saved[id]
	app.mu.Unlock()
	if path == "" {
		return
	}
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + path + `"`}
	if err := cmd.Start(); err == nil {
		go cmd.Wait()
	}
}

func numberOf(value any) float64 {
	number, _ := value.(float64)
	return number
}

//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// Session Panel files. The agent never opens a path the customer names: files the customer sends arrive from the
// tray (which reads them as the user) in chunks and are streamed to the server; files the technician sends are
// downloaded into the agent's own folder (SYSTEM and Administrators only), checked against their SHA-256, scanned by
// Windows Defender and handed to the tray in chunks once the customer accepts. Copies are removed when the customer
// answers or the session ends.

const (
	fileChunk    = 32 << 10
	fileMaxBytes = 100 << 20
	fileIdle     = 90 * time.Second
)

var fileDir = filepath.Join(agentDir, "session-files")

type sessionFile struct {
	ID         int64  `json:"id"`
	Direction  string `json:"direction"`
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	Type       string `json:"type"`
	SHA256     string `json:"sha256"`
	Executable bool   `json:"executable"`
	Status     string `json:"status"`
	Scan       string `json:"scan"`
	Detail     string `json:"detail"`
	From       string `json:"from"`
	At         string `json:"at"`
}

type fileUpload struct {
	conn    uint64
	session int64
	size    int64
	sent    int64
	last    time.Time
	writer  *io.PipeWriter
	done    chan fileResult
}

type fileResult struct {
	file *sessionFile
	err  error
}

type fileCopy struct {
	path string
	scan string
}

var fileRelay = struct {
	sync.Mutex
	session int64
	uploads map[int64]*fileUpload
	copies  map[int64]*fileCopy
	busy    map[int64]bool
	retry   map[int64]time.Time
}{uploads: map[int64]*fileUpload{}, copies: map[int64]*fileCopy{}, busy: map[int64]bool{}, retry: map[int64]time.Time{}}

// filesReset forgets everything from the previous session: uploads are abandoned and local copies deleted.
func filesReset(session int64) {
	fileRelay.Lock()
	if fileRelay.session == session {
		fileRelay.Unlock()
		return
	}
	fileRelay.session = session
	for id, up := range fileRelay.uploads {
		up.writer.CloseWithError(errors.New("the session ended"))
		delete(fileRelay.uploads, id)
	}
	fileRelay.copies = map[int64]*fileCopy{}
	fileRelay.busy = map[int64]bool{}
	fileRelay.retry = map[int64]time.Time{}
	fileRelay.Unlock()
	_ = os.RemoveAll(fileDir)
}

// fileTrayGone abandons the uploads of a tray connection that closed, so the server marks them failed.
func fileTrayGone(conn uint64) {
	fileRelay.Lock()
	defer fileRelay.Unlock()
	for id, up := range fileRelay.uploads {
		if up.conn == conn {
			up.writer.CloseWithError(errors.New("the Support app closed"))
			delete(fileRelay.uploads, id)
		}
	}
}

// filesView is the list a tray shows: the session's files, with whether a file for the customer is ready to save
// and how far an upload from this computer has got.
func filesView(session int64) []map[string]any {
	chatRelay.Lock()
	files := chatRelay.files
	same := chatRelay.session == session
	chatRelay.Unlock()
	out := []map[string]any{}
	if !same {
		return out
	}
	fileRelay.Lock()
	defer fileRelay.Unlock()
	for _, file := range files {
		item := map[string]any{
			"id": file.ID, "direction": file.Direction, "name": file.Name, "size": file.Size, "sha256": file.SHA256, "executable": file.Executable,
			"status": file.Status, "scan": file.Scan, "detail": file.Detail, "from": file.From, "at": file.At,
		}
		if copy := fileRelay.copies[file.ID]; copy != nil && file.Status == "offered" {
			item["ready"] = true
		}
		if up := fileRelay.uploads[file.ID]; up != nil {
			item["sent"] = up.sent
		}
		out = append(out, item)
	}
	return out
}

// filesPrepare fetches and scans each file offered to the customer, one goroutine per file, and drops copies of
// files that are no longer offered.
func filesPrepare(ctx context.Context, session int64, files []sessionFile) {
	offered := map[int64]bool{}
	fileRelay.Lock()
	for _, file := range files {
		if file.Direction != "to_customer" || file.Status != "offered" {
			continue
		}
		offered[file.ID] = true
		if fileRelay.session != session || fileRelay.busy[file.ID] || fileRelay.copies[file.ID] != nil || time.Now().Before(fileRelay.retry[file.ID]) {
			continue
		}
		fileRelay.busy[file.ID] = true
		go fileFetch(ctx, session, file)
	}
	for id, copy := range fileRelay.copies {
		if !offered[id] {
			_ = os.Remove(copy.path)
			delete(fileRelay.copies, id)
		}
	}
	fileRelay.Unlock()
}

func fileFetch(ctx context.Context, session int64, file sessionFile) {
	scan, path, err := fileDownload(ctx, session, file)
	fileRelay.Lock()
	delete(fileRelay.busy, file.ID)
	current := fileRelay.session == session
	if err != nil {
		fileRelay.retry[file.ID] = time.Now().Add(30 * time.Second)
	} else if current && scan != "threat" {
		fileRelay.copies[file.ID] = &fileCopy{path: path, scan: scan}
	}
	fileRelay.Unlock()
	var mismatch *fileMismatch
	switch {
	case errors.As(err, &mismatch):
		fileReport(session, file.ID, map[string]any{"action": "fail", "detail": "The file changed on the way to this computer."})
	case err != nil:
		fmt.Fprintf(os.Stderr, "session file %d: %v\n", file.ID, err)
	default:
		fileReport(session, file.ID, map[string]any{"action": "scan", "scan": scan})
		if scan == "threat" || !current {
			_ = os.Remove(path)
		}
	}
}

type fileMismatch struct{}

func (*fileMismatch) Error() string { return "size or SHA-256 mismatch" }

func fileDownload(ctx context.Context, session int64, file sessionFile) (string, string, error) {
	if err := os.MkdirAll(fileDir, 0o700); err != nil {
		return "", "", err
	}
	support.Lock()
	api, state := support.api, support.state
	support.Unlock()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/v1/agent/support/files/%d/content?session=%d", api, file.ID, session), nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("authorization", "Device "+state.DeviceToken)
	res, err := (&http.Client{Timeout: 30 * time.Minute}).Do(req)
	if err != nil {
		return "", "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("download: HTTP %d", res.StatusCode)
	}
	path := filepath.Join(fileDir, strconv.FormatInt(file.ID, 10))
	out, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return "", "", err
	}
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(res.Body, file.Size+1))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return "", "", err
	}
	if written != file.Size || file.SHA256 == "" || hex.EncodeToString(hash.Sum(nil)) != file.SHA256 {
		_ = os.Remove(path)
		return "", "", &fileMismatch{}
	}
	scan := defenderScan(path)
	if _, err := os.Stat(path); err != nil {
		scan = "threat"
	}
	return scan, path, nil
}

// defenderScan asks Windows Defender about one file: "clean", "threat", or "unavailable" when Defender is not the
// active antivirus or the scan could not run.
func defenderScan(path string) string {
	programFiles := os.Getenv("ProgramFiles")
	if programFiles == "" {
		programFiles = `C:\Program Files`
	}
	exe := filepath.Join(programFiles, "Windows Defender", "MpCmdRun.exe")
	if _, err := os.Stat(exe); err != nil {
		return "unavailable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "-Scan", "-ScanType", "3", "-File", path, "-DisableRemediation")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	err := cmd.Run()
	if err == nil {
		return "clean"
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 2 {
		return "threat"
	}
	return "unavailable"
}

func fileReport(session, fileID int64, payload map[string]any) (*sessionFile, error) {
	support.Lock()
	api, state := support.api, support.state
	support.Unlock()
	payload["sessionId"] = session
	raw, err := postJSON(fmt.Sprintf("%s/v1/agent/support/files/%d", api, fileID), state.DeviceToken, payload)
	if err != nil {
		return nil, err
	}
	var body struct {
		File *sessionFile `json:"file"`
	}
	_ = json.Unmarshal(raw, &body)
	return body.File, nil
}

// trayFile answers the tray's file requests for the live session it can see.
func trayFile(conn uint64, session uint32, req pipeRequest) map[string]any {
	info := supportLatest.Load()
	keys, live := info.liveSession()
	if !live || !info.Panel || req.SessionID != keys.ID || !sessionSees(keys, session) {
		return map[string]any{"ok": false, "error": "The session has ended."}
	}
	switch req.Op {
	case "fileSend":
		return fileStart(conn, session, keys.ID, req)
	case "fileChunk":
		return fileWrite(conn, keys.ID, req)
	case "fileCancel":
		return fileStop(conn, keys.ID, req.FileID)
	case "fileRead":
		return fileReadChunk(keys.ID, req)
	case "fileAccept", "fileDecline", "fileError":
		return fileAnswer(keys.ID, req)
	}
	return map[string]any{"ok": false, "error": "unknown request"}
}

func fileFail(message string) map[string]any {
	return map[string]any{"ok": false, "error": message}
}

func fileStart(conn uint64, session uint32, sessionID int64, req pipeRequest) map[string]any {
	if req.Size <= 0 {
		return fileFail("That file is empty.")
	}
	if req.Size > fileMaxBytes {
		return fileFail("Files can be up to 100 MB.")
	}
	support.Lock()
	api, state := support.api, support.state
	support.Unlock()
	raw, _ := json.Marshal(map[string]any{
		"sessionId": sessionID, "name": req.Name, "size": req.Size, "type": req.ContentType, "user": sessionUserName(session),
	})
	offerReq, err := http.NewRequest(http.MethodPost, api+"/v1/agent/support/files", bytes.NewReader(raw))
	if err != nil {
		return fileFail("Not sent.")
	}
	offerReq.Header.Set("content-type", "application/json")
	offerReq.Header.Set("authorization", "Device "+state.DeviceToken)
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(offerReq)
	if err != nil {
		return fileFail("The Digital Fingers server could not be reached.")
	}
	var body struct {
		Error string       `json:"error"`
		File  *sessionFile `json:"file"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body)
	res.Body.Close()
	if res.StatusCode >= 300 || body.File == nil {
		if body.Error == "" {
			body.Error = "Not sent."
		}
		return fileFail(body.Error)
	}
	reader, writer := io.Pipe()
	up := &fileUpload{conn: conn, session: sessionID, size: req.Size, last: time.Now(), writer: writer, done: make(chan fileResult, 1)}
	fileRelay.Lock()
	fileRelay.uploads[body.File.ID] = up
	fileRelay.Unlock()
	go fileSendBody(api, state.DeviceToken, body.File.ID, up, reader)
	go fileWatch(body.File.ID, up)
	return map[string]any{"ok": true, "file": body.File}
}

func fileSendBody(api, token string, fileID int64, up *fileUpload, body *io.PipeReader) {
	req, err := http.NewRequest(http.MethodPut,
		fmt.Sprintf("%s/v1/agent/support/files/%d/content?session=%d", api, fileID, up.session), body)
	if err != nil {
		body.CloseWithError(err)
		up.done <- fileResult{err: err}
		return
	}
	req.ContentLength = up.size
	req.Header.Set("content-type", "application/octet-stream")
	req.Header.Set("authorization", "Device "+token)
	res, err := (&http.Client{}).Do(req)
	if err != nil {
		body.CloseWithError(err)
		up.done <- fileResult{err: errors.New("The upload was interrupted.")}
		return
	}
	defer res.Body.Close()
	var reply struct {
		Error string       `json:"error"`
		File  *sessionFile `json:"file"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&reply)
	body.CloseWithError(errors.New("upload finished"))
	if res.StatusCode >= 300 {
		if reply.Error == "" {
			reply.Error = "The file could not be sent."
		}
		up.done <- fileResult{err: errors.New(reply.Error)}
		return
	}
	up.done <- fileResult{file: reply.File}
}

// fileWatch abandons an upload the tray stopped feeding.
func fileWatch(fileID int64, up *fileUpload) {
	for {
		time.Sleep(15 * time.Second)
		fileRelay.Lock()
		current := fileRelay.uploads[fileID] == up
		idle := current && time.Since(up.last) > fileIdle
		if idle {
			delete(fileRelay.uploads, fileID)
		}
		fileRelay.Unlock()
		if !current {
			return
		}
		if idle {
			up.writer.CloseWithError(errors.New("the upload stalled"))
			return
		}
	}
}

func fileWrite(conn uint64, sessionID int64, req pipeRequest) map[string]any {
	fileRelay.Lock()
	up := fileRelay.uploads[req.FileID]
	if up == nil || up.conn != conn || up.session != sessionID {
		fileRelay.Unlock()
		return fileFail("That upload has stopped.")
	}
	if req.Offset != up.sent || int64(len(req.Data)) > fileChunk || up.sent+int64(len(req.Data)) > up.size {
		fileRelay.Unlock()
		return fileFail("The file changed while it was being sent.")
	}
	up.last = time.Now()
	fileRelay.Unlock()
	if len(req.Data) > 0 {
		if _, err := up.writer.Write(req.Data); err != nil {
			fileForget(req.FileID, up)
			select {
			case result := <-up.done:
				if result.err != nil {
					return fileFail(result.err.Error())
				}
			case <-time.After(10 * time.Second):
			}
			return fileFail("The upload was interrupted.")
		}
	}
	fileRelay.Lock()
	up.sent += int64(len(req.Data))
	up.last = time.Now()
	sent, finished := up.sent, up.sent == up.size
	fileRelay.Unlock()
	if !finished {
		return map[string]any{"ok": true, "sent": sent}
	}
	_ = up.writer.Close()
	fileForget(req.FileID, up)
	select {
	case result := <-up.done:
		if result.err != nil {
			return fileFail(result.err.Error())
		}
		return map[string]any{"ok": true, "sent": sent, "done": true, "file": result.file}
	case <-time.After(2 * time.Minute):
		return fileFail("The server did not confirm the file.")
	}
}

func fileForget(fileID int64, up *fileUpload) {
	fileRelay.Lock()
	if fileRelay.uploads[fileID] == up {
		delete(fileRelay.uploads, fileID)
	}
	fileRelay.Unlock()
}

func fileStop(conn uint64, sessionID, fileID int64) map[string]any {
	fileRelay.Lock()
	up := fileRelay.uploads[fileID]
	if up != nil && up.conn == conn {
		delete(fileRelay.uploads, fileID)
	} else {
		up = nil
	}
	fileRelay.Unlock()
	if up == nil {
		return fileFail("That upload has already finished.")
	}
	fileReport(sessionID, fileID, map[string]any{"action": "cancel"})
	up.writer.CloseWithError(errors.New("cancelled"))
	return map[string]any{"ok": true}
}

func fileReadChunk(sessionID int64, req pipeRequest) map[string]any {
	fileRelay.Lock()
	copy := fileRelay.copies[req.FileID]
	current := fileRelay.session == sessionID
	fileRelay.Unlock()
	if copy == nil || !current || req.Offset < 0 {
		return fileFail("That file is no longer offered.")
	}
	in, err := os.Open(copy.path)
	if err != nil {
		return fileFail("That file is no longer offered.")
	}
	defer in.Close()
	buf := make([]byte, fileChunk)
	n, err := in.ReadAt(buf, req.Offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return fileFail("The file could not be read.")
	}
	return map[string]any{"ok": true, "data": buf[:n], "eof": n < fileChunk}
}

func fileAnswer(sessionID int64, req pipeRequest) map[string]any {
	fileRelay.Lock()
	copy := fileRelay.copies[req.FileID]
	if copy != nil {
		delete(fileRelay.copies, req.FileID)
	}
	fileRelay.Unlock()
	if copy == nil && req.Op == "fileAccept" {
		return fileFail("That file is no longer offered.")
	}
	if copy != nil {
		_ = os.Remove(copy.path)
	}
	payload := map[string]any{}
	switch req.Op {
	case "fileAccept":
		payload["action"] = "accept"
		payload["detail"] = `Saved in Downloads\Digital Fingers`
	case "fileDecline":
		payload["action"] = "decline"
	default:
		payload["action"] = "fail"
		payload["detail"] = clip(req.Detail, 200)
	}
	file, err := fileReport(sessionID, req.FileID, payload)
	if err != nil {
		return fileFail("The Digital Fingers server could not be reached.")
	}
	return map[string]any{"ok": true, "file": file}
}

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type savedState struct {
	DeviceID    int64  `json:"deviceId"`
	DeviceToken string `json:"deviceToken"`
}

type job struct {
	ID      int64  `json:"id"`
	Command string `json:"command"`
}

func main() {
	loadPlatformEnv()
	if err := start(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	api := strings.TrimRight(os.Getenv("DF_API_URL"), "/")
	statePath := os.Getenv("DF_STATE_PATH")
	if statePath == "" {
		statePath = defaultStatePath()
	}
	if api == "" {
		return fmt.Errorf("DF_API_URL is required")
	}

	state, err := loadState(statePath)
	if err != nil {
		return fmt.Errorf("state: %w", err)
	}
	if state.DeviceToken == "" {
		state, err = enroll(api, statePath)
		if err != nil {
			return fmt.Errorf("enroll: %w", err)
		}
		fmt.Println("enrolled")
	}

	for {
		if err := heartbeat(api, state); err != nil {
			fmt.Fprintln(os.Stderr, "heartbeat:", err)
		}
		timer := time.NewTimer(10 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func enroll(api, statePath string) (savedState, error) {
	token := strings.TrimSpace(os.Getenv("DF_ENROLL_TOKEN"))
	if token == "" {
		return savedState{}, fmt.Errorf("DF_ENROLL_TOKEN is required")
	}
	hostname, _ := os.Hostname()
	body, err := postJSON(api+"/v1/agent/enroll", "", map[string]string{
		"token":    token,
		"hostname": hostname,
		"osName":   prettyOS(),
	})
	if err != nil {
		return savedState{}, err
	}
	var parsed struct {
		DeviceID    int64  `json:"deviceId"`
		DeviceToken string `json:"deviceToken"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return savedState{}, err
	}
	if parsed.DeviceToken == "" {
		return savedState{}, fmt.Errorf("enroll response had no device token")
	}
	state := savedState{DeviceID: parsed.DeviceID, DeviceToken: parsed.DeviceToken}
	raw, err := json.Marshal(state)
	if err != nil {
		return savedState{}, err
	}
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		return savedState{}, err
	}
	if err := os.WriteFile(statePath, raw, 0o600); err != nil {
		return savedState{}, err
	}
	return state, nil
}

func heartbeat(api string, state savedState) error {
	hostname, _ := os.Hostname()
	body, err := postJSON(api+"/v1/agent/heartbeat", state.DeviceToken, map[string]string{
		"hostname": hostname,
		"osName":   prettyOS(),
	})
	if err != nil {
		return err
	}
	var parsed struct {
		Jobs []job `json:"jobs"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return err
	}
	for _, item := range parsed.Jobs {
		exitCode, output := runCommand(item.Command)
		_, err := postJSON(fmt.Sprintf("%s/v1/agent/jobs/%d/result", api, item.ID), state.DeviceToken, map[string]any{
			"exitCode": exitCode,
			"output":   output,
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, "job result:", err)
			continue
		}
		fmt.Printf("job %d finished\n", item.ID)
	}
	return nil
}

func postJSON(url, deviceToken string, payload any) ([]byte, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	if deviceToken != "" {
		req.Header.Set("authorization", "Device "+deviceToken)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return body, nil
}

func loadState(path string) (savedState, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return savedState{}, nil
	}
	if err != nil {
		return savedState{}, err
	}
	var state savedState
	if err := json.Unmarshal(raw, &state); err != nil {
		return savedState{}, err
	}
	return state, nil
}

type limitedWriter struct {
	buf *bytes.Buffer
	max int
}

func (writer *limitedWriter) Write(chunk []byte) (int, error) {
	room := writer.max - writer.buf.Len()
	if room <= 0 {
		return len(chunk), nil
	}
	if len(chunk) > room {
		chunk = chunk[:room]
	}
	_, err := writer.buf.Write(chunk)
	return len(chunk), err
}

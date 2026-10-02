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
	"sync"
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

type deploy struct {
	ID          int64  `json:"id"`
	PackageName string `json:"packageName"`
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

	go collectUpdatesLoop(ctx)
	go collectAssetLoop(ctx)

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
	payload := map[string]any{
		"hostname": hostname,
		"osName":   prettyOS(),
	}
	if sample, err := collectMetrics(); err != nil {
		fmt.Fprintln(os.Stderr, "metrics:", err)
	} else {
		payload["metrics"] = sample
	}
	updates, collected, includeUpdates := pendingUpdates()
	if includeUpdates {
		payload["updates"] = updates
	}
	assetItem, assetCollected, includeAsset := pendingAsset()
	if includeAsset {
		payload["asset"] = assetItem
	}
	body, err := postJSON(api+"/v1/agent/heartbeat", state.DeviceToken, payload)
	if err != nil {
		return err
	}
	if includeUpdates {
		markUpdatesSent(collected)
	}
	if includeAsset {
		markAssetSent(assetCollected)
	}
	var parsed struct {
		Jobs    []job    `json:"jobs"`
		Deploys []deploy `json:"deploys"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return err
	}
	for _, item := range parsed.Deploys {
		ok, detail := installDeploy(item.PackageName)
		_, err := postJSON(fmt.Sprintf("%s/v1/agent/deploys/%d/result", api, item.ID), state.DeviceToken, map[string]any{
			"ok":     ok,
			"detail": detail,
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, "deploy result:", err)
			continue
		}
		fmt.Printf("deploy %d finished\n", item.ID)
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

type updateItem struct {
	Name             string `json:"name"`
	CurrentVersion   string `json:"currentVersion"`
	AvailableVersion string `json:"availableVersion"`
}

var updateState struct {
	mu        sync.Mutex
	items     []updateItem
	collected time.Time
	sent      time.Time
}

func collectUpdatesLoop(ctx context.Context) {
	wait := time.Duration(0)
	for {
		if wait > 0 {
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
		items, err := collectUpdates()
		if err != nil {
			fmt.Fprintln(os.Stderr, "updates:", err)
			wait = time.Minute
			continue
		}
		updateState.mu.Lock()
		updateState.items = items
		updateState.collected = time.Now()
		updateState.mu.Unlock()
		wait = 15 * time.Minute
	}
}

func pendingUpdates() ([]updateItem, time.Time, bool) {
	updateState.mu.Lock()
	defer updateState.mu.Unlock()
	if updateState.collected.IsZero() || !updateState.collected.After(updateState.sent) {
		return nil, time.Time{}, false
	}
	items := append([]updateItem{}, updateState.items...)
	if items == nil {
		items = []updateItem{}
	}
	return items, updateState.collected, true
}

func markUpdatesSent(collected time.Time) {
	updateState.mu.Lock()
	updateState.sent = collected
	updateState.mu.Unlock()
}

type softwareItem struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type asset struct {
	Make     string         `json:"make"`
	Model    string         `json:"model"`
	Serial   string         `json:"serial"`
	Software []softwareItem `json:"software"`
}

var assetState struct {
	mu        sync.Mutex
	item      asset
	collected time.Time
	sent      time.Time
}

func collectAssetLoop(ctx context.Context) {
	wait := time.Duration(0)
	for {
		if wait > 0 {
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
		item, err := collectAsset()
		if err != nil {
			fmt.Fprintln(os.Stderr, "asset:", err)
			wait = time.Minute
			continue
		}
		if item.Software == nil {
			item.Software = []softwareItem{}
		}
		assetState.mu.Lock()
		assetState.item = item
		assetState.collected = time.Now()
		assetState.mu.Unlock()
		wait = 15 * time.Minute
	}
}

func pendingAsset() (asset, time.Time, bool) {
	assetState.mu.Lock()
	defer assetState.mu.Unlock()
	if assetState.collected.IsZero() || !assetState.collected.After(assetState.sent) {
		return asset{}, time.Time{}, false
	}
	item := assetState.item
	item.Software = append([]softwareItem{}, assetState.item.Software...)
	return item, assetState.collected, true
}

func markAssetSent(collected time.Time) {
	assetState.mu.Lock()
	assetState.sent = collected
	assetState.mu.Unlock()
}

func decodeUpdates(raw []byte) ([]updateItem, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return []updateItem{}, nil
	}
	if raw[0] == '[' {
		var items []updateItem
		if err := json.Unmarshal(raw, &items); err != nil {
			return nil, err
		}
		if items == nil {
			return []updateItem{}, nil
		}
		return items, nil
	}
	var item updateItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	if item.Name == "" {
		return []updateItem{}, nil
	}
	return []updateItem{item}, nil
}

type sample struct {
	CPUPercent       int   `json:"cpuPercent"`
	MemoryPercent    int   `json:"memoryPercent"`
	MemoryUsedBytes  int64 `json:"memoryUsedBytes"`
	MemoryTotalBytes int64 `json:"memoryTotalBytes"`
	DiskPercent      int   `json:"diskPercent"`
	DiskUsedBytes    int64 `json:"diskUsedBytes"`
	DiskTotalBytes   int64 `json:"diskTotalBytes"`
	UptimeSeconds    int64 `json:"uptimeSeconds"`
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

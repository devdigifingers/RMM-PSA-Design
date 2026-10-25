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
	"sync/atomic"
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
	go installLoop(ctx, api, state)

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
		"users":    collectUsers(),
	}
	if sample, err := collectMetrics(); err != nil {
		fmt.Fprintln(os.Stderr, "metrics:", err)
	} else {
		payload["metrics"] = sample
	}
	updates, rebootPending, collected, includeUpdates := pendingUpdates()
	if includeUpdates {
		payload["updates"] = updates
		payload["rebootPending"] = rebootPending
	}
	payload["acceptDeploys"] = !installing.Load() && len(deployQueue) == 0
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
		Jobs        []job    `json:"jobs"`
		Deploys     []deploy `json:"deploys"`
		ScanUpdates string   `json:"scanUpdates"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return err
	}
	if parsed.ScanUpdates != "" && parsed.ScanUpdates != lastScanRequest {
		lastScanRequest = parsed.ScanUpdates
		requestScan()
	}
	for _, item := range parsed.Deploys {
		select {
		case deployQueue <- item:
		default:
			fmt.Fprintln(os.Stderr, "deploy queue full, skipping", item.ID)
		}
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
	KB               string `json:"kb"`
	Severity         string `json:"severity"`
	Category         string `json:"category"`
	CategoryID       string `json:"categoryId"`
	SizeBytes        int64  `json:"sizeBytes"`
	Restart          bool   `json:"restart"`
}

type updateScan struct {
	Updates       []updateItem `json:"updates"`
	RebootPending bool         `json:"rebootPending"`
}

var updateState struct {
	mu            sync.Mutex
	items         []updateItem
	rebootPending bool
	collected     time.Time
	sent          time.Time
}

var (
	scanNow         = make(chan struct{}, 1)
	lastScanRequest string
	deployQueue     = make(chan deploy, 4)
	installing      atomic.Bool
)

func requestScan() {
	select {
	case scanNow <- struct{}{}:
	default:
	}
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
			case <-scanNow:
				timer.Stop()
			}
		}
		scan, err := collectUpdates()
		if err != nil {
			fmt.Fprintln(os.Stderr, "updates:", err)
			wait = time.Minute
			continue
		}
		updateState.mu.Lock()
		updateState.items = scan.Updates
		updateState.rebootPending = scan.RebootPending
		updateState.collected = time.Now()
		updateState.mu.Unlock()
		wait = 15 * time.Minute
	}
}

func pendingUpdates() ([]updateItem, bool, time.Time, bool) {
	updateState.mu.Lock()
	defer updateState.mu.Unlock()
	if updateState.collected.IsZero() || !updateState.collected.After(updateState.sent) {
		return nil, false, time.Time{}, false
	}
	items := append([]updateItem{}, updateState.items...)
	if items == nil {
		items = []updateItem{}
	}
	return items, updateState.rebootPending, updateState.collected, true
}

func installLoop(ctx context.Context, api string, state savedState) {
	for {
		select {
		case <-ctx.Done():
			return
		case item := <-deployQueue:
			installing.Store(true)
			ok, restart, detail := installDeploy(item.PackageName)
			_, err := postJSON(fmt.Sprintf("%s/v1/agent/deploys/%d/result", api, item.ID), state.DeviceToken, map[string]any{
				"ok":              ok,
				"restartRequired": restart,
				"detail":          detail,
			})
			if err != nil {
				fmt.Fprintln(os.Stderr, "deploy result:", err)
			} else {
				fmt.Printf("deploy %d finished\n", item.ID)
			}
			installing.Store(false)
			requestScan()
		}
	}
}

func cleanUpdates(items []updateItem) []updateItem {
	if len(items) > 200 {
		items = items[:200]
	}
	cleaned := []updateItem{}
	for _, item := range items {
		item.Name = clip(strings.TrimSpace(item.Name), 200)
		item.CurrentVersion = clip(strings.TrimSpace(item.CurrentVersion), 120)
		item.AvailableVersion = clip(strings.TrimSpace(item.AvailableVersion), 120)
		item.KB = clip(strings.TrimSpace(item.KB), 20)
		item.Severity = clip(strings.TrimSpace(item.Severity), 20)
		item.Category = clip(strings.TrimSpace(item.Category), 60)
		item.CategoryID = clip(strings.ToLower(strings.TrimSpace(item.CategoryID)), 40)
		if item.SizeBytes < 0 {
			item.SizeBytes = 0
		}
		if item.Name == "" {
			continue
		}
		cleaned = append(cleaned, item)
	}
	return cleaned
}

func clip(text string, max int) string {
	if len(text) > max {
		return text[:max]
	}
	return text
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

func decodeScan(raw []byte) (updateScan, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return updateScan{Updates: []updateItem{}}, nil
	}
	var shape struct {
		Updates       json.RawMessage `json:"updates"`
		RebootPending bool            `json:"rebootPending"`
	}
	if err := json.Unmarshal(raw, &shape); err != nil {
		return updateScan{}, err
	}
	scan := updateScan{Updates: []updateItem{}, RebootPending: shape.RebootPending}
	list := bytes.TrimSpace(shape.Updates)
	switch {
	case len(list) == 0 || string(list) == "null":
	case list[0] == '[':
		if err := json.Unmarshal(list, &scan.Updates); err != nil {
			return updateScan{}, err
		}
	default:
		var item updateItem
		if err := json.Unmarshal(list, &item); err != nil {
			return updateScan{}, err
		}
		scan.Updates = []updateItem{item}
	}
	scan.Updates = cleanUpdates(scan.Updates)
	return scan, nil
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

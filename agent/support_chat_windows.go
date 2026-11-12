//go:build windows

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Session Panel chat: while a technician is connected, the agent keeps one long-poll open to the server and holds
// the conversation in memory; trays read it with their state and send through the agent, so the server is only
// reached by the agent's device login. Only the long-poll adds messages, so the held list stays in id order.

const chatKeep = 500

type chatMessage struct {
	ID   int64  `json:"id"`
	From string `json:"from"`
	Name string `json:"name"`
	Text string `json:"text"`
	At   string `json:"at"`
}

type chatPoll struct {
	SessionID int64         `json:"sessionId"`
	Messages  []chatMessage `json:"messages"`
	Typing    bool          `json:"typing"`
	Read      int64         `json:"read"`
}

var chatRelay = struct {
	sync.Mutex
	session  int64
	messages []chatMessage
	typing   bool
	read     int64
}{}

func chatReset(session int64) {
	chatRelay.Lock()
	defer chatRelay.Unlock()
	if chatRelay.session == session {
		return
	}
	chatRelay.session = session
	chatRelay.messages = nil
	chatRelay.typing = false
	chatRelay.read = 0
}

func chatAdd(session int64, messages []chatMessage) {
	chatRelay.Lock()
	defer chatRelay.Unlock()
	if chatRelay.session != session {
		return
	}
	for _, message := range messages {
		if n := len(chatRelay.messages); n == 0 || message.ID > chatRelay.messages[n-1].ID {
			chatRelay.messages = append(chatRelay.messages, message)
		}
	}
	if extra := len(chatRelay.messages) - chatKeep; extra > 0 {
		chatRelay.messages = append([]chatMessage(nil), chatRelay.messages[extra:]...)
	}
}

// chatView is the conversation for one tray: messages after the ones it already shows, whether the technician is
// typing and how far the technician has read.
func chatView(session, after int64) map[string]any {
	chatRelay.Lock()
	defer chatRelay.Unlock()
	if chatRelay.session != session {
		return map[string]any{"messages": []chatMessage{}, "typing": false, "read": 0}
	}
	messages := []chatMessage{}
	for _, message := range chatRelay.messages {
		if message.ID > after {
			messages = append(messages, message)
		}
	}
	return map[string]any{"messages": messages, "typing": chatRelay.typing, "read": chatRelay.read}
}

// chatLoop keeps the long-poll open while a session is live on a tenant that shows the panel.
func chatLoop(ctx context.Context) {
	client := &http.Client{Timeout: 45 * time.Second}
	fails := 0
	for ctx.Err() == nil {
		info := supportLatest.Load()
		keys, live := info.liveSession()
		if !live || !info.Panel || info.Silent {
			chatReset(0)
			sleepCtx(ctx, 2*time.Second)
			continue
		}
		chatReset(keys.ID)
		chatRelay.Lock()
		after, typing, read := int64(0), chatRelay.typing, chatRelay.read
		if n := len(chatRelay.messages); n > 0 {
			after = chatRelay.messages[n-1].ID
		}
		chatRelay.Unlock()
		poll, err := chatFetch(ctx, client, keys.ID, after, typing, read)
		if err != nil {
			fails++
			sleepCtx(ctx, time.Duration(min(fails, 10))*3*time.Second)
			continue
		}
		fails = 0
		chatAdd(keys.ID, poll.Messages)
		chatRelay.Lock()
		if chatRelay.session == keys.ID {
			chatRelay.typing = poll.Typing
			chatRelay.read = poll.Read
		}
		chatRelay.Unlock()
	}
}

func sleepCtx(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

func chatFetch(ctx context.Context, client *http.Client, session, after int64, typing bool, read int64) (*chatPoll, error) {
	support.Lock()
	api, state := support.api, support.state
	support.Unlock()
	query := url.Values{}
	query.Set("session", strconv.FormatInt(session, 10))
	query.Set("after", strconv.FormatInt(after, 10))
	query.Set("read", strconv.FormatInt(read, 10))
	query.Set("wait", "1")
	if typing {
		query.Set("typing", "1")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api+"/v1/agent/support/chat?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("authorization", "Device "+state.DeviceToken)
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("chat: HTTP %d", res.StatusCode)
	}
	var poll chatPoll
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&poll); err != nil {
		return nil, err
	}
	return &poll, nil
}

// trayChat sends what the customer typed: a message, a typing signal or a read mark, only for the live session
// this tray can see.
func trayChat(session uint32, req pipeRequest) map[string]any {
	info := supportLatest.Load()
	keys, live := info.liveSession()
	if !live || !info.Panel || req.SessionID != keys.ID || !sessionSees(keys, session) {
		return map[string]any{"ok": false, "error": "The session has ended."}
	}
	payload := map[string]any{"sessionId": keys.ID}
	switch {
	case req.Text != "":
		text := strings.TrimSpace(req.Text)
		if text == "" || len([]rune(text)) > 2000 {
			return map[string]any{"ok": false, "error": "Messages can be at most 2,000 characters."}
		}
		payload["text"] = text
		payload["user"] = sessionUserName(session)
	case req.Typing != nil:
		payload["typing"] = *req.Typing
	case req.Read > 0:
		payload["read"] = req.Read
	default:
		return map[string]any{"ok": false, "error": "Nothing to send."}
	}
	support.Lock()
	api, state := support.api, support.state
	support.Unlock()
	raw, _ := json.Marshal(payload)
	httpReq, err := http.NewRequest(http.MethodPost, api+"/v1/agent/support/chat", bytes.NewReader(raw))
	if err != nil {
		return map[string]any{"ok": false, "error": "Not sent."}
	}
	httpReq.Header.Set("content-type", "application/json")
	httpReq.Header.Set("authorization", "Device "+state.DeviceToken)
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(httpReq)
	if err != nil {
		return map[string]any{"ok": false, "error": "The Digital Fingers server could not be reached."}
	}
	defer res.Body.Close()
	var body struct {
		Error   string       `json:"error"`
		Message *chatMessage `json:"message"`
	}
	_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body)
	if res.StatusCode >= 300 {
		if body.Error == "" {
			body.Error = "Not sent."
		}
		return map[string]any{"ok": false, "error": body.Error}
	}
	if body.Message != nil {
		return map[string]any{"ok": true, "message": body.Message}
	}
	return map[string]any{"ok": true}
}

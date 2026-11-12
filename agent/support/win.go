//go:build windows

package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                         = windows.NewLazySystemDLL("user32.dll")
	dwmapi                         = windows.NewLazySystemDLL("dwmapi.dll")
	procSetWindowLongPtr           = user32.NewProc("SetWindowLongPtrW")
	procGetWindowLongPtr           = user32.NewProc("GetWindowLongPtrW")
	procCallWindowProc             = user32.NewProc("CallWindowProcW")
	procSetWindowPos               = user32.NewProc("SetWindowPos")
	procSendMessage                = user32.NewProc("SendMessageW")
	procCreateIconFromResourceEx   = user32.NewProc("CreateIconFromResourceEx")
	procSetWindowDisplayAffinity   = user32.NewProc("SetWindowDisplayAffinity")
	procMonitorFromWindow          = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfo             = user32.NewProc("GetMonitorInfoW")
	procGetDpiForWindow            = user32.NewProc("GetDpiForWindow")
	procSetProcessDpiAwareness     = user32.NewProc("SetProcessDpiAwarenessContext")
	procSetForegroundWindow        = user32.NewProc("SetForegroundWindow")
	procShowWindow                 = user32.NewProc("ShowWindow")
	procGetWindowRect              = user32.NewProc("GetWindowRect")
	procFindWindow                 = user32.NewProc("FindWindowW")
	procReleaseCapture             = user32.NewProc("ReleaseCapture")
	procDwmSetWindowAttribute      = dwmapi.NewProc("DwmSetWindowAttribute")
	procCreateMutex                = windows.NewLazySystemDLL("kernel32.dll").NewProc("CreateMutexW")
	procGetClientRect              = user32.NewProc("GetClientRect")
	procEnumChildWindows           = user32.NewProc("EnumChildWindows")
	procGetClassName               = user32.NewProc("GetClassNameW")
	procIsWindowVisible            = user32.NewProc("IsWindowVisible")
	procGetWindowThreadProcessId   = user32.NewProc("GetWindowThreadProcessId")
	procGetDC                      = user32.NewProc("GetDC")
	procReleaseDC                  = user32.NewProc("ReleaseDC")
	procGetPixel                   = windows.NewLazySystemDLL("gdi32.dll").NewProc("GetPixel")
)

const (
	gwlStyle               = ^uintptr(15) // -16
	gwlExStyle             = ^uintptr(19) // -20
	gwlpWndProc            = ^uintptr(3)  // -4
	wsPopup                = 0x80000000
	wsVisible              = 0x10000000
	wsClipChildren         = 0x02000000
	wsClipSiblings         = 0x04000000
	wsExTopmost            = 0x00000008
	wsExAppWindow          = 0x00040000
	swpNoActivate          = 0x0010
	swpFrameChanged        = 0x0020
	swpShowWindow          = 0x0040
	hwndTopmost            = ^uintptr(0) // -1
	wmClose                = 0x0010
	wmSetIcon              = 0x0080
	wmDisplayChange        = 0x007E
	wmSettingChange        = 0x001A
	wmNCLButtonDown        = 0x00A1
	wmMoving               = 0x0216
	wmExitSizeMove         = 0x0232
	wmDpiChanged           = 0x02E0
	htCaption              = 2
	wdaNone                = 0x0
	wdaExcludeFromCapture  = 0x11
	monitorDefaultPrimary  = 0x1
	dwmwaCornerPreference  = 33
	dwmwcpRound            = 2
	swShowNoActivate       = 4
	swRestore              = 9
	errorAlreadyExists     = 183
	dpiPerMonitorAwareV2   = ^uintptr(3) // -4
)

type rect struct{ Left, Top, Right, Bottom int32 }

type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

func dpiAware() {
	if procSetProcessDpiAwareness.Find() == nil {
		procSetProcessDpiAwareness.Call(dpiPerMonitorAwareV2)
	}
}

// singleInstance keeps one tray per session; the named mutex lives in the session's own namespace.
func singleInstance(name string) bool {
	ptr, _ := windows.UTF16PtrFromString(`Local\` + name)
	handle, _, err := procCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(ptr)))
	if handle == 0 {
		return false
	}
	return err != syscall.Errno(errorAlreadyExists)
}

// waitForTaskbar waits until Explorer's taskbar exists; right after sign-in the tray can start before it does, and a
// notification icon added then is lost.
func waitForTaskbar(limit time.Duration) bool {
	class, _ := windows.UTF16PtrFromString("Shell_TrayWnd")
	for start := time.Now(); time.Since(start) < limit; time.Sleep(time.Second) {
		if hwnd, _, _ := procFindWindow.Call(uintptr(unsafe.Pointer(class)), 0); hwnd != 0 {
			return true
		}
	}
	return false
}

// iconFromICO picks the image closest to size from an .ico file and turns it into an HICON.
func iconFromICO(data []byte, size int) uintptr {
	if len(data) < 6 {
		return 0
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	best, bestWidth := -1, 0
	for i := 0; i < count; i++ {
		at := 6 + i*16
		if at+16 > len(data) {
			break
		}
		width := int(data[at])
		if width == 0 {
			width = 256
		}
		better := best < 0 ||
			(width >= size && (bestWidth < size || width < bestWidth)) ||
			(width < size && bestWidth < size && width > bestWidth)
		if better {
			best, bestWidth = i, width
		}
	}
	if best < 0 {
		return 0
	}
	at := 6 + best*16
	length := int(binary.LittleEndian.Uint32(data[at+8 : at+12]))
	offset := int(binary.LittleEndian.Uint32(data[at+12 : at+16]))
	if offset+length > len(data) || length == 0 {
		return 0
	}
	image := data[offset : offset+length]
	icon, _, _ := procCreateIconFromResourceEx.Call(uintptr(unsafe.Pointer(&image[0])), uintptr(length), 1, 0x00030000, uintptr(size), uintptr(size), 0)
	return icon
}

func setWindowIcon(hwnd uintptr, data []byte) {
	if small := iconFromICO(data, 16); small != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, 0, small)
	}
	if big := iconFromICO(data, 32); big != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, 1, big)
	}
}

// makePanelWindow turns the WebView window into a borderless, always-on-top window that still has a taskbar
// button, with rounded corners on Windows 11.
func makePanelWindow(hwnd uintptr) {
	procSetWindowLongPtr.Call(hwnd, gwlStyle, wsPopup|wsVisible|wsClipChildren|wsClipSiblings)
	ex, _, _ := procGetWindowLongPtr.Call(hwnd, gwlExStyle)
	procSetWindowLongPtr.Call(hwnd, gwlExStyle, ex|wsExTopmost|wsExAppWindow)
	if procDwmSetWindowAttribute.Find() == nil {
		pref := uint32(dwmwcpRound)
		procDwmSetWindowAttribute.Call(hwnd, dwmwaCornerPreference, uintptr(unsafe.Pointer(&pref)), 4)
	}
}

// hideFromCapture keeps the panel out of screen captures, including the remote view (Windows 10 2004 and later).
func hideFromCapture(hwnd uintptr, hide bool) bool {
	mode := uintptr(wdaNone)
	if hide {
		mode = wdaExcludeFromCapture
	}
	ok, _, _ := procSetWindowDisplayAffinity.Call(hwnd, mode)
	return ok != 0
}

var (
	childList     []string
	childCallback = syscall.NewCallback(func(child, _ uintptr) uintptr {
		name := make([]uint16, 128)
		procGetClassName.Call(child, uintptr(unsafe.Pointer(&name[0])), uintptr(len(name)))
		var r rect
		procGetWindowRect.Call(child, uintptr(unsafe.Pointer(&r)))
		visible, _, _ := procIsWindowVisible.Call(child)
		var pid uint32
		procGetWindowThreadProcessId.Call(child, uintptr(unsafe.Pointer(&pid)))
		childList = append(childList, fmt.Sprintf("%s %dx%d@%d,%d visible=%d pid=%d",
			windows.UTF16ToString(name), r.Right-r.Left, r.Bottom-r.Top, r.Left, r.Top, visible, pid))
		return 1
	})
)

// describeWindow reports the window, the WebView2 windows inside it and what the screen shows at the header and the
// middle (a COLORREF, 0x00BBGGRR; the header should be dark). Pixels are only meaningful when not hidden from capture.
func describeWindow(hwnd uintptr) string {
	var outer, inner rect
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&outer)))
	procGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&inner)))
	childList = nil
	procEnumChildWindows.Call(hwnd, childCallback, 0)
	screen, _, _ := procGetDC.Call(0)
	header, _, _ := procGetPixel.Call(screen, uintptr(outer.Left+40), uintptr(outer.Top+12))
	middle, _, _ := procGetPixel.Call(screen, uintptr((outer.Left+outer.Right)/2), uintptr((outer.Top+outer.Bottom)/2))
	procReleaseDC.Call(0, screen)
	return fmt.Sprintf("window %dx%d@%d,%d client %dx%d; header pixel %06x, middle pixel %06x; children: %v",
		outer.Right-outer.Left, outer.Bottom-outer.Top, outer.Left, outer.Top, inner.Right, inner.Bottom,
		uint32(header), uint32(middle), childList)
}

func dpiScale(hwnd uintptr) float64 {
	if procGetDpiForWindow.Find() != nil {
		return 1
	}
	dpi, _, _ := procGetDpiForWindow.Call(hwnd)
	if dpi == 0 {
		return 1
	}
	return float64(dpi) / 96
}

func workArea(hwnd uintptr) rect {
	monitor, _, _ := procMonitorFromWindow.Call(hwnd, monitorDefaultPrimary)
	info := monitorInfo{}
	info.Size = uint32(unsafe.Sizeof(info))
	if ok, _, _ := procGetMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok == 0 {
		return rect{0, 0, 1280, 720}
	}
	return info.Work
}

// dockGap is the current gap to the right edge in device pixels, used to keep the window on the edge while dragged.
var dockGap int32

// dock places the window against the right edge of the work area; CSS pixels are scaled to the monitor's DPI.
// at is where the window sits between the top (0) and the bottom (1) of the work area.
func dock(hwnd uintptr, width, height, margin int, at float64) {
	scale := dpiScale(hwnd)
	area := workArea(hwnd)
	w := int32(float64(width) * scale)
	h := int32(float64(height) * scale)
	gap := int32(float64(margin) * scale)
	dockGap = gap
	if maxH := area.Bottom - area.Top - 2*gap; h > maxH {
		h = maxH
	}
	if at < 0 || at > 1 {
		at = 0.4
	}
	x := area.Right - w - gap
	y := area.Top + gap + int32(at*float64(area.Bottom-area.Top-2*gap-h))
	procSetWindowPos.Call(hwnd, hwndTopmost, uintptr(x), uintptr(y), uintptr(w), uintptr(h), swpNoActivate|swpFrameChanged|swpShowWindow)
}

// dockedAt reports where the window sits on the right edge, in the same terms dock takes.
func dockedAt(hwnd uintptr) float64 {
	var r rect
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 {
		return -1
	}
	area := workArea(hwnd)
	room := area.Bottom - area.Top - 2*dockGap - (r.Bottom - r.Top)
	if room <= 0 {
		return 0
	}
	at := float64(r.Top-area.Top-dockGap) / float64(room)
	return min(max(at, 0), 1)
}

func bringForward(hwnd uintptr) {
	procShowWindow.Call(hwnd, swRestore)
	procSetForegroundWindow.Call(hwnd)
}

// startDrag lets the user drag the window from its header; the move is kept to the right edge by keepOnEdge.
func startDrag(hwnd uintptr) {
	procReleaseCapture.Call()
	procSendMessage.Call(hwnd, wmNCLButtonDown, htCaption, 0)
}

func keepOnEdge(hwnd uintptr, moving *rect) {
	area := workArea(hwnd)
	w, h := moving.Right-moving.Left, moving.Bottom-moving.Top
	moving.Right = area.Right - dockGap
	moving.Left = moving.Right - w
	if moving.Top < area.Top+dockGap {
		moving.Top = area.Top + dockGap
	}
	if moving.Top+h > area.Bottom-dockGap {
		moving.Top = area.Bottom - dockGap - h
	}
	moving.Bottom = moving.Top + h
}

type windowHooks struct {
	close   func()
	moved   func()
	rescale func()
}

var (
	originalWndProc uintptr
	hooks           windowHooks
)

// subclass guards Alt+F4 and other close requests (the panel asks before ending the session), keeps drags on the
// right edge and re-docks when the display changes.
func subclass(hwnd uintptr, with windowHooks) {
	hooks = with
	callback := syscall.NewCallback(func(h, msg, wparam, lparam uintptr) uintptr {
		switch msg {
		case wmClose:
			if hooks.close != nil {
				hooks.close()
				return 0
			}
		case wmMoving:
			keepOnEdge(h, (*rect)(unsafe.Pointer(lparam)))
			return 1
		case wmExitSizeMove:
			if hooks.moved != nil {
				hooks.moved()
			}
		case wmDisplayChange, wmDpiChanged, wmSettingChange:
			ret, _, _ := procCallWindowProc.Call(originalWndProc, h, msg, wparam, lparam)
			if hooks.rescale != nil {
				hooks.rescale()
			}
			return ret
		}
		ret, _, _ := procCallWindowProc.Call(originalWndProc, h, msg, wparam, lparam)
		return ret
	})
	originalWndProc, _, _ = procSetWindowLongPtr.Call(hwnd, gwlpWndProc, callback)
}

func openLink(target string) {
	verb, _ := windows.UTF16PtrFromString("open")
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return
	}
	_ = windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}

func message(title, text string) {
	t, _ := windows.UTF16PtrFromString(title)
	b, _ := windows.UTF16PtrFromString(text)
	_, _ = windows.MessageBox(0, b, t, windows.MB_OK|windows.MB_ICONINFORMATION|windows.MB_TOPMOST)
}

func localDataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return fmt.Sprintf(`%s\DigitalFingers\Support`, base)
}

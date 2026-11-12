//go:build windows

package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"strconv"
	"sync"
)

// A 3×5 pixel font for the unread count on the tray icon.
var badgeFont = map[rune][5]string{
	'0': {"111", "101", "101", "101", "111"},
	'1': {"010", "110", "010", "010", "111"},
	'2': {"111", "001", "111", "100", "111"},
	'3': {"111", "001", "111", "001", "111"},
	'4': {"101", "101", "111", "001", "001"},
	'5': {"111", "100", "111", "001", "111"},
	'6': {"111", "100", "111", "101", "111"},
	'7': {"111", "001", "001", "001", "001"},
	'8': {"111", "101", "111", "101", "111"},
	'9': {"111", "101", "111", "001", "111"},
	'+': {"000", "010", "111", "010", "000"},
}

var badgeCache = struct {
	sync.Mutex
	icons map[string][]byte
}{icons: map[string][]byte{}}

// badgeIcon returns the tray icon with a red unread count in the corner, at every size the icon holds; the plain
// icon if it can't be drawn.
func badgeIcon(name string, base []byte, count int) []byte {
	if count <= 0 {
		return base
	}
	label := strconv.Itoa(count)
	if count > 9 {
		label = "9+"
	}
	key := name + ":" + label
	badgeCache.Lock()
	defer badgeCache.Unlock()
	if icon, ok := badgeCache.icons[key]; ok {
		return icon
	}
	icon := drawBadgeIcon(base, label)
	if icon == nil {
		icon = base
	}
	badgeCache.icons[key] = icon
	return icon
}

// drawBadgeIcon reads an ICO whose images are PNGs, draws the badge on each and writes a new ICO.
func drawBadgeIcon(base []byte, label string) []byte {
	if len(base) < 6 {
		return nil
	}
	count := int(binary.LittleEndian.Uint16(base[4:6]))
	type frame struct {
		width int
		data  []byte
	}
	frames := make([]frame, 0, count)
	for i := 0; i < count; i++ {
		entry := 6 + 16*i
		if entry+16 > len(base) {
			return nil
		}
		size := int(binary.LittleEndian.Uint32(base[entry+8:]))
		at := int(binary.LittleEndian.Uint32(base[entry+12:]))
		if at < 0 || size <= 0 || at+size > len(base) {
			return nil
		}
		src, err := png.Decode(bytes.NewReader(base[at : at+size]))
		if err != nil {
			return nil
		}
		bounds := src.Bounds()
		canvas := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
		draw.Draw(canvas, canvas.Bounds(), src, bounds.Min, draw.Src)
		drawBadge(canvas, label)
		var out bytes.Buffer
		if png.Encode(&out, canvas) != nil {
			return nil
		}
		frames = append(frames, frame{width: bounds.Dx(), data: out.Bytes()})
	}
	var ico bytes.Buffer
	_ = binary.Write(&ico, binary.LittleEndian, [3]uint16{0, 1, uint16(len(frames))})
	offset := 6 + 16*len(frames)
	for _, f := range frames {
		side := byte(f.width)
		if f.width >= 256 {
			side = 0
		}
		ico.Write([]byte{side, side, 0, 0})
		_ = binary.Write(&ico, binary.LittleEndian, [2]uint16{1, 32})
		_ = binary.Write(&ico, binary.LittleEndian, [2]uint32{uint32(len(f.data)), uint32(offset)})
		offset += len(f.data)
	}
	for _, f := range frames {
		ico.Write(f.data)
	}
	return ico.Bytes()
}

func drawBadge(canvas *image.NRGBA, label string) {
	side := canvas.Bounds().Dx()
	diameter := float64(side) * 0.62
	radius := diameter / 2
	cx, cy := float64(side)-radius, radius
	red := color.NRGBA{R: 0xDC, G: 0x26, B: 0x26, A: 0xFF}
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			cover := radius + 0.5 - math.Hypot(float64(x)+0.5-cx, float64(y)+0.5-cy)
			if cover > 0 {
				blendPixel(canvas, x, y, red, math.Min(cover, 1))
			}
		}
	}
	scale := int(diameter * 0.55 / 5)
	if scale < 1 {
		scale = 1
	}
	glyphs := []rune(label)
	width := len(glyphs)*3*scale + (len(glyphs)-1)*scale
	left := int(math.Round(cx - float64(width)/2))
	top := int(math.Round(cy - float64(5*scale)/2))
	white := color.NRGBA{R: 0xFF, G: 0xFF, B: 0xFF, A: 0xFF}
	for i, glyph := range glyphs {
		rows := badgeFont[glyph]
		for row := 0; row < 5; row++ {
			for col := 0; col < 3; col++ {
				if rows[row][col] != '1' {
					continue
				}
				x0, y0 := left+i*4*scale+col*scale, top+row*scale
				for dy := 0; dy < scale; dy++ {
					for dx := 0; dx < scale; dx++ {
						if image.Pt(x0+dx, y0+dy).In(canvas.Bounds()) {
							canvas.SetNRGBA(x0+dx, y0+dy, white)
						}
					}
				}
			}
		}
	}
}

func blendPixel(canvas *image.NRGBA, x, y int, over color.NRGBA, alpha float64) {
	under := canvas.NRGBAAt(x, y)
	ua := float64(under.A) / 255
	oa := alpha * float64(over.A) / 255
	outA := oa + ua*(1-oa)
	if outA <= 0 {
		return
	}
	mix := func(o, u uint8) uint8 {
		return uint8(math.Round((float64(o)*oa + float64(u)*ua*(1-oa)) / outA))
	}
	canvas.SetNRGBA(x, y, color.NRGBA{R: mix(over.R, under.R), G: mix(over.G, under.G), B: mix(over.B, under.B), A: uint8(math.Round(outA * 255))})
}

#!/usr/bin/env python3
"""Render a labeled capability demo. Not a live DeepSeek Harness recording."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
W, H = 1920, 1080
FPS = 30
DURATION = 24.0

BG = (248, 250, 252, 255)
INK = (16, 24, 40, 255)
MUTED = (71, 84, 103, 255)
FAINT = (152, 162, 179, 255)
LINE = (208, 213, 221, 255)
CARD = (255, 255, 255, 255)
BLUE = (47, 107, 255, 255)
NAVY = (24, 73, 169, 255)
SOFT = (239, 244, 255, 255)
RED = (180, 35, 24, 255)
GREEN = (6, 118, 71, 255)
DASH = (37, 59, 128, 255)

CJK_CANDIDATES = (
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
)
MONO_CANDIDATES = (
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/macos/JetBrainsMono-Regular.ttf',
    '/System/Library/Fonts/Menlo.ttc',
)


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if value < lo else hi if value > hi else value


def ease_out(t: float) -> float:
    t = clamp(t)
    return 1.0 - (1.0 - t) ** 3


def window(t: float, start: float, end: float, fade: float = 0.28) -> float:
    if t < start or t > end:
        return 0.0
    if t < start + fade:
        return ease_out((t - start) / fade)
    if t > end - fade:
        return ease_out((end - t) / fade)
    return 1.0


def local_t(t: float, start: float, end: float) -> float:
    return 0.0 if end <= start else clamp((t - start) / (end - start))


def first_font(paths: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont:
    for path in paths:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


class Fonts:
    def __init__(self) -> None:
        self.display = first_font(CJK_CANDIDATES, 54)
        self.title = first_font(CJK_CANDIDATES, 36)
        self.body = first_font(CJK_CANDIDATES, 24)
        self.small = first_font(CJK_CANDIDATES, 20)
        self.tiny = first_font(CJK_CANDIDATES, 16)
        self.mono = first_font(MONO_CANDIDATES, 18)
        self.mono_sm = first_font(MONO_CANDIDATES, 15)
        self.badge = first_font(CJK_CANDIDATES, 17)


def load_assets() -> dict[str, Image.Image]:
    image = Image.open(HERE / 'fixtures' / 'oversized-image-4096x3072.png')
    image.thumbnail((640, 480), Image.Resampling.LANCZOS)
    image = image.convert('RGBA')
    architecture = Image.open(ROOT / 'docs' / 'assets' / 'dsh-dragndrop-architecture.png').convert('RGBA')
    return {'image': image, 'architecture': architecture}


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill, outline=None, width: int = 1) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def shadow_card(base: Image.Image, box: tuple[int, int, int, int], radius: int = 16, alpha: int = 40) -> None:
    x0, y0, x1, y1 = box
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle((x0 + 6, y0 + 10, x1 + 6, y1 + 10), radius=radius, fill=(16, 24, 40, alpha))
    base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(10)))


def draw_dashed_rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, color, width: int = 3, dash: int = 16) -> None:
    # Pillow has no dashed rounded rect; approximate with a solid faint fill plus short edge dashes.
    rounded(draw, box, radius, fill=(255, 255, 255, 210), outline=color, width=width)
    x0, y0, x1, y1 = box
    for x in range(x0 + radius, x1 - radius, dash * 2):
        draw.line((x, y0, min(x + dash, x1 - radius), y0), fill=color, width=width)
        draw.line((x, y1, min(x + dash, x1 - radius), y1), fill=color, width=width)
    for y in range(y0 + radius, y1 - radius, dash * 2):
        draw.line((x0, y, x0, min(y + dash, y1 - radius)), fill=color, width=width)
        draw.line((x1, y, x1, min(y + dash, y1 - radius)), fill=color, width=width)


def mix(a: tuple[int, ...], b: tuple[int, ...], t: float) -> tuple[int, ...]:
    t = clamp(t)
    return tuple(int(p + (q - p) * t) for p, q in zip(a, b))


def apply_alpha(img: Image.Image, alpha: float) -> Image.Image:
    if alpha >= 0.999:
        return img
    out = img.copy()
    bands = list(out.split())
    bands[-1] = bands[-1].point(lambda p: int(p * clamp(alpha)))
    return Image.merge('RGBA', bands)


class Demo:
    def __init__(self) -> None:
        self.fonts = Fonts()
        self.assets = load_assets()
        self.beats = (
            (0.00, 2.20, 'Capability demo  ·  能力演示', 'Labeled animation from real fixtures  ·  not a live DSH recording'),
            (2.20, 5.20, 'Drag image  ·  拖入图片', '4096×3072 → 1823×1367  ·  native image path, not a plugin upload dump'),
            (5.20, 8.00, 'Drag folder  ·  拖入文件夹', 'First-class folder card  ·  relative paths  ·  no fake .zip name'),
            (8.00, 10.00, 'Paste  ·  粘贴', 'Clipboard files and screenshots use the same intake as drag'),
            (10.00, 14.40, 'Office  ·  DOCX / XLSX / PPTX', 'Word paths, Excel ranges, slides + notes  ·  not .doc/.xls/.ppt or PDF'),
            (14.40, 17.20, 'ZIP  ·  压缩包', 'List the tree, search text, read one path  ·  binaries stay listed-only'),
            (17.20, 21.60, 'On-demand tools  ·  按需读取', 'search / spreadsheet range / slide  ·  the model gets a slice'),
            (21.60, 24.00, 'Send the slice  ·  只发送片段', 'Local files become queryable context, not prompt ballast'),
        )

    def frame(self, t: float) -> Image.Image:
        img = Image.new('RGBA', (W, H), BG)
        draw = ImageDraw.Draw(img)
        self.draw_chrome(img, draw, t)
        scenes = (
            (0.00, 2.40, self.scene_title),
            (2.05, 5.40, self.scene_image),
            (5.05, 8.20, self.scene_folder),
            (7.85, 10.20, self.scene_paste),
            (9.85, 14.60, self.scene_office),
            (14.25, 17.40, self.scene_zip),
            (17.05, 21.80, self.scene_tools),
            (21.40, 24.00, self.scene_close),
        )
        for start, end, fn in scenes:
            alpha = window(t, start, end, fade=0.32)
            if alpha <= 0:
                continue
            layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            fn(layer, ImageDraw.Draw(layer), t, start, end, alpha)
            img.alpha_composite(apply_alpha(layer, alpha))
        return img.convert('RGB')

    def draw_chrome(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float) -> None:
        draw.rectangle((0, 0, W, 84), fill=(255, 255, 255, 255))
        draw.line((0, 84, W, 84), fill=LINE, width=1)
        draw.text((48, 26), 'dsh-dragndrop-attachments', font=self.fonts.title, fill=INK)
        badge = 'CAPABILITY DEMO  ·  not a live DSH recording'
        bbox = draw.textbbox((0, 0), badge, font=self.fonts.badge)
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        bx1, by1 = W - 48, 22
        bx0, by0 = bx1 - bw - 28, 18
        rounded(draw, (bx0, by0, bx1, by0 + bh + 16), 20, SOFT, BLUE, 2)
        draw.text((bx0 + 14, by0 + 6), badge, font=self.fonts.badge, fill=NAVY)
        draw.rectangle((0, H - 96, W, H), fill=(255, 255, 255, 255))
        draw.line((0, H - 96, W, H - 96), fill=LINE, width=1)
        title, subtitle = self.beats[0][2], self.beats[0][3]
        for start, end, beat_title, beat_sub in self.beats:
            if start <= t < end:
                title, subtitle = beat_title, beat_sub
                break
        draw.text((48, H - 82), title, font=self.fonts.title, fill=INK)
        draw.text((48, H - 40), subtitle, font=self.fonts.small, fill=MUTED)
        elapsed = min(t / DURATION, 1.0)
        draw.rectangle((0, H - 6, W, H), fill=(226, 232, 240, 255))
        draw.rectangle((0, H - 6, int(W * elapsed), H), fill=BLUE)

    def scene_title(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        art = self.assets['architecture'].copy()
        art.thumbnail((1480, 760), Image.Resampling.LANCZOS)
        x = (W - art.width) // 2
        y = 110 + int((1 - ease_out(local_t(t, start, start + 0.8))) * 24)
        img.alpha_composite(art, (x, y))

    def scene_image(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        p = ease_out(local_t(t, start, start + 0.7))
        zone = (80, 140, 900, 900)
        drop = Image.new('RGBA', img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(drop)
        draw_dashed_rect(d, zone, 28, mix(LINE, BLUE, p))
        d.text((160, 480), '拖到这里，自动处理图片、文件和文件夹', font=self.fonts.body, fill=DASH)
        d.text((160, 524), 'Drop anywhere on the page  ·  image, file, or folder', font=self.fonts.small, fill=MUTED)
        img.alpha_composite(drop)
        thumb = self.assets['image']
        tx = 980 + int((1 - p) * 80)
        ty = 200
        shadow_card(img, (tx, ty, tx + thumb.width + 48, ty + thumb.height + 160), 18, 36)
        card = Image.new('RGBA', img.size, (0, 0, 0, 0))
        c = ImageDraw.Draw(card)
        rounded(c, (tx, ty, tx + thumb.width + 48, ty + thumb.height + 160), 18, CARD, LINE, 1)
        card.paste(thumb, (tx + 24, ty + 24), thumb)
        c.text((tx + 24, ty + thumb.height + 40), 'oversized-image-4096x3072.png', font=self.fonts.small, fill=INK)
        c.text((tx + 24, ty + thumb.height + 74), '4096×3072 → 1823×1367', font=self.fonts.body, fill=GREEN)
        c.text((tx + 24, ty + thumb.height + 112), 'Native DSH image well  ·  Codex-style patch budget', font=self.fonts.tiny, fill=MUTED)
        img.alpha_composite(card)

    def file_card(self, draw: ImageDraw.ImageDraw, x: int, y: int, w: int, badge: str, name: str, meta: str, accent=BLUE) -> None:
        rounded(draw, (x, y, x + w, y + 118), 14, CARD, LINE, 1)
        rounded(draw, (x + 16, y + 28, x + 72, y + 80), 10, SOFT, accent, 1)
        bb = draw.textbbox((0, 0), badge, font=self.fonts.tiny)
        draw.text((x + 44 - (bb[2] - bb[0]) // 2, y + 42), badge, font=self.fonts.tiny, fill=NAVY)
        draw.text((x + 88, y + 30), name, font=self.fonts.body, fill=INK)
        draw.text((x + 88, y + 68), meta, font=self.fonts.small, fill=MUTED)

    def scene_folder(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        p = ease_out(local_t(t, start, start + 0.65))
        y = 170 + int((1 - p) * 30)
        shadow_card(img, (120, y, 900, y + 140), 16, int(28 * alpha))
        self.file_card(draw, 120, y, 780, 'DIR', 'sample-folder', '3 files  ·  2 folders  ·  READY  ·  local snapshot')
        rows = (
            ('docs/', 'directory'),
            ('docs/README.md', '北京分行 91'),
            ('docs/quoted-newlines.csv', 'quoted newlines + comma'),
            ('src/index.ts', 'export const score = 91'),
        )
        for i, (path, note) in enumerate(rows):
            ry = y + 168 + i * 86 + int((1 - ease_out(local_t(t, start + 0.15 + i * 0.08, start + 0.55))) * 18)
            rounded(draw, (160, ry, 900, ry + 74), 12, CARD, LINE, 1)
            draw.text((188, ry + 12), path, font=self.fonts.mono, fill=NAVY)
            draw.text((188, ry + 42), note, font=self.fonts.small, fill=MUTED)
        rounded(draw, (980, 220, 1840, 820), 20, SOFT, (178, 204, 255, 255), 2)
        draw.text((1020, 260), 'Folder, not a forged ZIP name', font=self.fonts.title, fill=INK)
        draw.text((1020, 330), 'Browser snapshot keeps the root and\nrelative paths. Empty dirs survive when\nthe picker can report them.\n\nModel tools:\n  read_folder_entry\n  query_folder_document', font=self.fonts.body, fill=MUTED)

    def scene_paste(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        p = ease_out(local_t(t, start, start + 0.55))
        x = 220 + int((1 - p) * 40)
        rounded(draw, (x, 240, x + 1480, 820), 24, CARD, LINE, 1)
        rounded(draw, (x + 48, 300, x + 260, 380), 22, SOFT, BLUE, 2)
        draw.text((x + 78, 324), 'CLIPBOARD', font=self.fonts.small, fill=NAVY)
        draw.text((x + 292, 318), '⌘V  /  Ctrl+V  near the composer', font=self.fonts.title, fill=INK)
        self.file_card(draw, x + 48, 430, 700, 'MD', 'paste-note.md', 'READY  ·  UTF-8 text index  ·  search + line blocks')
        self.file_card(draw, x + 780, 430, 650, 'IMG', 'clipboard image', 'Native image path  ·  same as a drop')
        draw.text((x + 48, 590), 'Three equivalent intakes: page-wide drag, paste, or + → 文件和文件夹.', font=self.fonts.body, fill=MUTED)
        draw.text((x + 48, 640), 'The editor text is not rewritten. Cards are the only draft state.', font=self.fonts.body, fill=MUTED)

    def scene_office(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        cards = (
            ('DOCX', 'operations-policy.docx', 'search 北京分行  →  /body/tbl[1]', 'Word semantic path'),
            ('XLSX', 'operations-analysis.xlsx', '汇总!A1:D2  ·  =B2*C2  ·  FORMULA_ONLY', 'Exact range + hidden 隐藏参数'),
            ('PPTX', 'operations-report.pptx', 'slide 1  ·  重点指标为 83 分', 'Body + 演讲者备注'),
        )
        highlight = min(2, int(local_t(t, start + 0.4, end - 0.3) * 3))
        for i, (badge, name, loc, note) in enumerate(cards):
            x = 90 + i * 610
            y = 200 + int((1 - ease_out(local_t(t, start + i * 0.12, start + 0.55))) * 26)
            active = i == highlight
            shadow_card(img, (x, y, x + 580, y + 620), 20, 44 if active else 20)
            rounded(draw, (x, y, x + 580, y + 620), 20, CARD, BLUE if active else LINE, 3 if active else 1)
            rounded(draw, (x + 28, y + 32, x + 120, y + 84), 10, SOFT, BLUE, 1)
            draw.text((x + 48, y + 46), badge, font=self.fonts.small, fill=NAVY)
            draw.text((x + 28, y + 120), name, font=self.fonts.body, fill=INK)
            draw.text((x + 28, y + 170), note, font=self.fonts.small, fill=MUTED)
            rounded(draw, (x + 28, y + 230, x + 552, y + 560), 14, (248, 250, 252, 255), LINE, 1)
            draw.text((x + 48, y + 258), loc, font=self.fonts.mono, fill=NAVY)
            extras = {
                0: '经营制度\n本月运营指标总体平稳\n表格：北京分行  0.83  2',
                1: '分行        指标值   权重   得分\n北京分行    0.83     100    =B2*C2\n\nHidden sheet kept in the outline.',
                2: '六页经营结论\n重点指标为 83 分。\n\n演讲者备注：关注北京分行排名第二。',
            }[i]
            draw.text((x + 48, y + 330), extras, font=self.fonts.small, fill=INK)

    def scene_zip(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        p = ease_out(local_t(t, start, start + 0.6))
        self.file_card(draw, 120, 170, 820, 'ZIP', 'project-archive.zip', 'READY  ·  safe tree index  ·  ZIP only (no RAR/7z/tar)')
        rows = (
            ('README.md', 'text  ·  北京分行得分 91', BLUE),
            ('src/index.ts', 'text  ·  export const score = 91', BLUE),
            ('assets/logo.bin', 'binary  ·  listed only  ·  not unpacked into the prompt', FAINT),
        )
        for i, (path, note, color) in enumerate(rows):
            y = 330 + i * 120 + int((1 - ease_out(local_t(t, start + 0.15 + i * 0.1, start + 0.6))) * 16)
            rounded(draw, (160, y, 920, y + 100), 14, CARD, LINE, 1)
            draw.text((188, y + 18), path, font=self.fonts.mono, fill=color)
            draw.text((188, y + 56), note, font=self.fonts.small, fill=MUTED)
        rounded(draw, (1020, 200, 1840, 860), 20, NAVY)
        draw.text((1060, 250), 'On demand, not the archive', font=self.fonts.title, fill=(255, 255, 255, 255))
        draw.text((1060, 330), 'get_attachment_outline\nsearch_attachment  “北京分行”\nread_archive_entry  README.md  1–3', font=self.fonts.mono, fill=(209, 224, 255, 255))
        draw.text((1060, 520), 'Traversal and compression-bomb\nsamples are rejected before storage.\nNested archives are not auto-expanded.', font=self.fonts.body, fill=(209, 224, 255, 255))

    def scene_tools(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        tools = (
            ('search_attachment', 'query: 北京分行', 'operations-policy.docx  →  /body/tbl[1]'),
            ('read_spreadsheet_range', 'sheet: 汇总   range: A1:D2', '北京分行  0.83  100  =B2*C2   FORMULA_ONLY'),
            ('read_slide', 'slide_number: 1   include_notes: true', '重点指标为 83 分  ·  演讲者备注：关注北京分行排名第二。'),
        )
        draw.text((80, 140), 'The model asks for a locator. The file stays on disk.', font=self.fonts.title, fill=INK)
        for i, (name, args, result) in enumerate(tools):
            appear = ease_out(local_t(t, start + 0.15 + i * 0.35, start + 0.55 + i * 0.35))
            y = 220 + i * 230 + int((1 - appear) * 24)
            x = 80
            rounded(draw, (x, y, 1840, y + 206), 18, CARD, LINE, 1)
            rounded(draw, (x + 24, y + 24, x + 430, y + 76), 12, SOFT, BLUE, 1)
            draw.text((x + 44, y + 38), name, font=self.fonts.mono, fill=NAVY)
            draw.text((x + 454, y + 40), args, font=self.fonts.small, fill=MUTED)
            draw.text((x + 44, y + 108), result, font=self.fonts.body, fill=INK)
            draw.text((x + 44, y + 154), 'Cite filename + locator. Never claim COMPLETE on PARTIAL coverage.', font=self.fonts.tiny, fill=FAINT)

    def scene_close(self, img: Image.Image, draw: ImageDraw.ImageDraw, t: float, start: float, end: float, alpha: float) -> None:
        art = self.assets['architecture'].copy()
        art.thumbnail((1600, 720), Image.Resampling.LANCZOS)
        x = (W - art.width) // 2
        y = 118
        img.alpha_composite(apply_alpha(art, 0.38), (x, y))
        rounded(draw, (220, 360, 1700, 720), 24, (24, 73, 169, 235))
        draw.text((280, 410), 'Local files become queryable context,\nnot prompt ballast.', font=self.fonts.display, fill=(255, 255, 255, 255))
        draw.text((280, 600), 'github.com/aa2246740/dsh-dragndrop-attachments', font=self.fonts.body, fill=(209, 224, 255, 255))


def encode_mp4(frames_dir: Path, mp4: Path) -> None:
    mp4.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        'ffmpeg', '-y',
        '-framerate', str(FPS),
        '-i', str(frames_dir / 'frame-%04d.png'),
        '-vf', 'format=yuv420p,scale=1920:1080:flags=lanczos',
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-crf', '20',
        '-movflags', '+faststart',
        str(mp4),
    ]
    subprocess.run(cmd, check=True)


def encode_gif(mp4: Path, gif: Path) -> None:
    # Faster, smaller loop for README. Palette from the sped-up cut.
    vf = (
        'setpts=0.42*PTS,fps=12,scale=800:-1:flags=lanczos,'
        'split[s0][s1];[s0]palettegen=max_colors=80:stats_mode=diff[p];'
        '[s1][p]paletteuse=dither=bayer:bayer_scale=4'
    )
    subprocess.run(['ffmpeg', '-y', '-i', str(mp4), '-vf', vf, '-loop', '0', str(gif)], check=True)


def render(mp4: Path, gif: Path | None, frames_dir: Path) -> None:
    frames_dir.mkdir(parents=True, exist_ok=True)
    demo = Demo()
    total = int(DURATION * FPS)
    for index in range(total):
        t = index / FPS
        frame = demo.frame(t)
        frame.save(frames_dir / f'frame-{index:04d}.png', optimize=True)
        if index % 30 == 0 or index == total - 1:
            print(f'rendered {index + 1}/{total}', flush=True)
    encode_mp4(frames_dir, mp4)
    print(f'wrote {mp4}', flush=True)
    if gif is not None:
        encode_gif(mp4, gif)
        print(f'wrote {gif}', flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description='Render the labeled capability demo.')
    parser.add_argument('--mp4', type=Path, default=HERE / 'out' / 'plugin-demo.mp4')
    parser.add_argument('--gif', type=Path, default=HERE / 'out' / 'plugin-demo.gif')
    parser.add_argument('--no-gif', action='store_true')
    parser.add_argument('--frames', type=Path, default=None)
    parser.add_argument('--preview', type=Path, default=None, help='Write keyframes only, then exit.')
    args = parser.parse_args()
    if args.preview is not None:
        args.preview.mkdir(parents=True, exist_ok=True)
        demo = Demo()
        for t in (0.4, 3.4, 6.4, 8.8, 12.0, 15.6, 19.2, 22.8):
            demo.frame(t).save(args.preview / f't-{t:.1f}.png')
            print(f'preview t={t:.1f}', flush=True)
        return 0
    frames = args.frames or Path(tempfile.mkdtemp(prefix='dsh-demo-frames-'))
    try:
        render(args.mp4, None if args.no_gif else args.gif, frames)
    finally:
        if args.frames is None:
            shutil.rmtree(frames, ignore_errors=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())

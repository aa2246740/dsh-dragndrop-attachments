#!/usr/bin/env bash
# Assemble docs/demo/out/plugin-demo.mp4 and plugin-demo.gif.
#
# Default: labeled capability animation from real fixtures (not a live DSH recording).
# --from-raw: stitch docs/demo/raw/NN-id.mov|mp4 in shotlist order.
#             Missing clips → print them, dry-run, exit 0.
# --dry-run:  print the plan only.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
raw_dir="$here/raw"
out_dir="$here/out"
mp4="$out_dir/plugin-demo.mp4"
gif="$out_dir/plugin-demo.gif"
font=''
for candidate in \
  /usr/share/fonts/truetype/wqy/wqy-microhei.ttc \
  /usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf \
  /System/Library/Fonts/PingFang.ttc
do
  if [[ -f "$candidate" ]]; then
    font="$candidate"
    break
  fi
done

# id|English bar|Chinese bar
shots=(
  '01-drag-image|Drag image|拖入图片'
  '02-drag-folder|Drag folder|拖入文件夹'
  '03-paste|Paste|粘贴'
  '04-docx|DOCX on demand|Word 语义路径'
  '05-xlsx|XLSX range|Excel 精确区间'
  '06-pptx|PPTX slide|幻灯片 + 备注'
  '07-zip|ZIP entry|ZIP 按路径读取'
  '08-on-demand|On-demand tools|按需搜索 / 区间 / 幻灯片'
)

mode='capability'
dry_run=0
for arg in "$@"; do
  case "$arg" in
    --from-raw) mode='raw' ;;
    --capability) mode='capability' ;;
    --dry-run) dry_run=1 ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      echo "usage: $0 [--capability|--from-raw] [--dry-run]" >&2
      exit 2
      ;;
  esac
done

find_clip() {
  local id="$1"
  local path
  for path in "$raw_dir/$id.mov" "$raw_dir/$id.mp4"; do
    if [[ -f "$path" ]]; then
      printf '%s\n' "$path"
      return 0
    fi
  done
  local match
  match="$(find "$raw_dir" -maxdepth 1 \( -name "${id}*.mov" -o -name "${id}*.mp4" \) -type f | sort | head -n 1 || true)"
  if [[ -n "$match" ]]; then
    printf '%s\n' "$match"
    return 0
  fi
  return 1
}

list_raw_plan() {
  local spec id bar_en bar_zh clip missing=0
  echo "RAW_PLAN  expected clips in $raw_dir"
  for spec in "${shots[@]}"; do
    IFS='|' read -r id bar_en bar_zh <<<"$spec"
    if clip="$(find_clip "$id")"; then
      echo "  FOUND   $id  $clip  ($bar_en / $bar_zh)"
    else
      echo "  MISSING $id  ${id}.mov or ${id}.mp4  ($bar_en / $bar_zh)"
      missing=1
    fi
  done
  return "$missing"
}

need_ffmpeg() {
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is required to encode the demo video." >&2
    exit 1
  fi
}

need_pillow() {
  if python3 -c 'from PIL import Image' >/dev/null 2>&1; then
    return 0
  fi
  echo "Pillow is required for the capability renderer; installing..."
  python3 -m pip install --user pillow
}

prepare_fixtures() {
  bash "$here/prepare-fixtures.sh"
}

render_capability() {
  need_ffmpeg
  need_pillow
  prepare_fixtures
  echo "CAPABILITY_RENDER  labeled animation from fixtures + docs/assets (not a live DSH recording)"
  if [[ "$dry_run" -eq 1 ]]; then
    echo "DRY_RUN  would write $mp4 and $gif"
    return 0
  fi
  mkdir -p "$out_dir"
  python3 "$here/render-capability-demo.py" --mp4 "$mp4" --gif "$gif"
  echo "ASSEMBLE_OK  $mp4"
  echo "ASSEMBLE_OK  $gif"
}

escape_drawtext() {
  # ffmpeg drawtext: escape \ : ' 
  python3 -c 'import sys; print(sys.argv[1].replace("\\\\","\\\\\\\\").replace(":","\\\\:").replace("'"'"'","\\\\'"'"'"))' "$1"
}

stitch_raw() {
  need_ffmpeg
  prepare_fixtures
  local missing=0
  if ! list_raw_plan; then
    missing=1
  fi
  if [[ "$missing" -eq 1 ]]; then
    echo "DRY_RUN  raw clips incomplete; not encoding. Drop the MISSING files into $raw_dir and re-run --from-raw."
    echo "         Capability MP4/GIF: run $0  (no --from-raw)."
    return 0
  fi
  if [[ "$dry_run" -eq 1 ]]; then
    echo "DRY_RUN  would stitch ${#shots[@]} clips into $mp4 and derive $gif"
    return 0
  fi
  if [[ -z "$font" ]]; then
    echo "no CJK-capable font found for subtitle bars" >&2
    exit 1
  fi
  mkdir -p "$out_dir"
  local work spec id bar_en bar_zh clip i=0 part parts=()
  work="$(mktemp -d "${TMPDIR:-/tmp}/dsh-demo-raw.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  for spec in "${shots[@]}"; do
    IFS='|' read -r id bar_en bar_zh <<<"$spec"
    clip="$(find_clip "$id")"
    part="$work/part-$(printf '%02d' "$i").mp4"
    local label
    label="$(escape_drawtext "$bar_en  ·  $bar_zh")"
    ffmpeg -y -i "$clip" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,drawbox=x=0:y=ih-96:w=iw:h=96:color=white@0.92:t=fill,drawtext=fontfile=${font}:text='${label}':x=48:y=h-62:fontsize=32:fontcolor=0x101828" \
      -c:v libx264 -pix_fmt yuv420p -an "$part"
    parts+=("$part")
    i=$((i + 1))
  done
  local list="$work/concat.txt"
  : > "$list"
  for part in "${parts[@]}"; do
    printf "file '%s'\n" "$part" >> "$list"
  done
  ffmpeg -y -f concat -safe 0 -i "$list" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$mp4"
  ffmpeg -y -i "$mp4" -vf "setpts=0.42*PTS,fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=80:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" -loop 0 "$gif"
  echo "ASSEMBLE_OK  $mp4"
  echo "ASSEMBLE_OK  $gif"
}

case "$mode" in
  capability) render_capability ;;
  raw) stitch_raw ;;
esac

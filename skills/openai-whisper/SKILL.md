---
name: faster-whisper
description: Local speech-to-text with faster-whisper (CTranslate2). Use for audio/video transcription when you need fast, accurate local transcription without API costs. Supports macOS Metal (MPS), CUDA, and CPU backends.
metadata: { "openclaw": { "emoji": "⚡", "requires": { "venv": ".venv-faster-whisper" } } }
---

# faster-whisper (本地转写)

用 faster-whisper 做音频/视频转写，比原版 whisper 快 4-10 倍。

## 环境

- 虚拟环境：`~/.openclaw/workspace/.venv-faster-whisper`
- 模型缓存：`~/.cache/huggingface/hub/models--Systran--faster-whisper-*`
- 输出目录：`~/Downloads/whisper_out_fw/`

## 快速开始

### Python 调用

```python
from faster_whisper import WhisperModel

# 模型选择：tiny, base, small, medium, large-v3
model_size = "small"

# macOS 用 "metal"，Linux/Windows 用 "cuda"，CPU 用 "cpu"
device = "auto"  # 自动检测 GPU

model = WhisperModel(model_size, device=device, compute_type="float16")
segments, info = model.transcribe("/path/to/audio.m4a", language="zh")

print(f"语言: {info.language}, 概率: {info.language_probability:.2f}")
for segment in segments:
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
```

### 命令行用法

```bash
# 激活环境
source ~/.openclaw/workspace/.venv-faster-whisper/bin/activate

# 基本转写
faster-whisper /path/to/audio.m4a --model small --language zh

# 输出为 srt 字幕
faster-whisper /path/to/audio.m4a --model small --output_format srt

# 指定输出目录
faster-whisper /path/to/audio.m4a --model small --output_dir /tmp/transcripts
```

## 可用模型

| 模型     | 参数  | 推荐场景             |
| -------- | ----- | -------------------- |
| tiny     | 39M   | 快速测试             |
| base     | 74M   | 快速转写             |
| small    | 244M  | 平衡速度精度（推荐） |
| medium   | 769M  | 高精度               |
| large-v3 | 1550M | 最高精度             |

## 设备选择

- **macOS Apple Silicon**: `device="metal"` 或 `device="auto"`
- **NVIDIA GPU**: `device="cuda"`
- **CPU**: `device="cpu"`（慢但通用）

## 输出格式

通过 `output_format` 参数选择：

- `txt` - 纯文本
- `srt` - 字幕文件
- `vtt` - WebVTT 字幕
- `json` - 完整 JSON（包含时间戳）
- `all` - 全部格式

## 视频处理

先提取音频：

```bash
ffmpeg -i video.mp4 -vn -acodec libmp3lame -q:a 2 audio.mp3
# 或 m4a（更小）
ffmpeg -i video.mp4 -vn -acodec aac -b:a 128k audio.m4a
```

## 完整脚本示例

```bash
#!/bin/bash
# 转写脚本

AUDIO_FILE="$1"
MODEL="${2:-small}"
LANGUAGE="${3:-zh}"
OUTPUT_DIR="${4:-$HOME/Downloads/whisper_out_fw}"

source ~/.openclaw/workspace/.venv-faster-whisper/bin/activate

mkdir -p "$OUTPUT_DIR"

BASE_NAME=$(basename "$AUDIO_FILE" | sed 's/\.[^.]*$//')

faster-whisper "$AUDIO_FILE" \
    --model "$MODEL" \
    --language "$LANGUAGE" \
    --output_format all \
    --output_dir "$OUTPUT_DIR"

echo "完成！输出在: $OUTPUT_DIR/${BASE_NAME}.{txt,srt,json}"
```

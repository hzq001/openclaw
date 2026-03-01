---
name: whisper-cpp
description: Local speech-to-text with whisper.cpp. Use for audio/video transcription when you need low-latency local transcription. On Apple Silicon, this uses Metal GPU acceleration.
metadata: { "openclaw": { "emoji": "⚡" } }
---

# whisper.cpp (本地转写)

使用 `whisper-cli` 做本地音频/视频转写。

- Apple Silicon: 走 Metal GPU
- 不依赖 Python 虚拟环境
- 适合直接接入 OpenClaw `tools.media.audio`

## 环境

- 可执行文件：`/opt/homebrew/bin/whisper-cli`
- 推荐模型：`/Users/huangziquan/.openclaw/models/whisper/ggml-base.bin`
- 输出目录：`/tmp`（或自定义目录）

## 快速开始

### 安装与模型准备

```bash
brew install whisper-cpp
mkdir -p /Users/huangziquan/.openclaw/models/whisper
curl -L --fail -o /Users/huangziquan/.openclaw/models/whisper/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

### 命令行转写

```bash
# 生成 txt（无时间戳）
whisper-cli \
  -m /Users/huangziquan/.openclaw/models/whisper/ggml-base.bin \
  -l zh \
  -otxt \
  -of /tmp/transcript \
  -np \
  -nt \
  /path/to/audio.wav

# 查看结果
cat /tmp/transcript.txt
```

### OpenClaw 配置示例（推荐）

```json5
{
  tools: {
    media: {
      concurrency: 2,
      audio: {
        enabled: true,
        maxBytes: 20971520,
        timeoutSeconds: 60,
        language: "zh",
        models: [
          {
            type: "cli",
            command: "whisper-cli",
            args: [
              "-m",
              "/Users/huangziquan/.openclaw/models/whisper/ggml-base.bin",
              "-l",
              "zh",
              "-otxt",
              "-of",
              "{{OutputBase}}",
              "-np",
              "-nt",
              "{{MediaPath}}",
            ],
          },
        ],
      },
    },
  },
}
```

## 常用参数

- `-m`: 模型路径
- `-l zh`: 语言提示（中文）
- `-otxt`: 输出 txt
- `-of`: 输出基础文件名（不含后缀）
- `-np`: 精简打印
- `-nt`: 禁用时间戳

## GPU 验证（Apple Silicon）

执行一次转写并检查日志中是否出现：

```text
whisper_backend_init_gpu: using Metal backend
ggml_metal_device_init: GPU name: Apple M1 Pro
```

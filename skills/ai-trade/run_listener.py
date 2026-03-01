import os
import sys
import subprocess
import argparse

def main():
    parser = argparse.ArgumentParser(description="Run ai-trade listener")
    parser.add_argument("--source", default="all", help="Source to listen from (jin10, cls, all)")
    parser.add_argument("--target", required=True, help="Target chat_id or phone number")
    args = parser.parse_args()

    ai_trade_dir = "/Users/huangziquan/mac-doc/code/my/ai-trade"
    if not os.path.exists(ai_trade_dir):
        print(f"Error: Directory {ai_trade_dir} not found.")
        sys.exit(1)

    cmd = [
        "uv", "run", "python", "scripts/ai_trade.py",
        "listener", "run",
        "--source", args.source,
        "--target", args.target
    ]

    print(f"Running: {' '.join(cmd)} in {ai_trade_dir}")
    try:
        subprocess.run(cmd, cwd=ai_trade_dir, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {e}")
        sys.exit(e.returncode)
    except KeyboardInterrupt:
        print("\nListener stopped by user.")
        sys.exit(0)

if __name__ == "__main__":
    main()

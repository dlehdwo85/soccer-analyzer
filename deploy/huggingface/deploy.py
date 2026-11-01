"""백엔드를 Hugging Face Space(무료 CPU)로 배포한다.

사용:
  HF_TOKEN=... HF_SPACE=<사용자명>/<space이름> python deploy/huggingface/deploy.py [--secrets]

- Space가 없으면 Docker Space로 만든다 (브라우저에서 API를 불러야 하므로 공개 Space).
- backend/ 내용 + 이 폴더의 Dockerfile·README를 Space 최상위로 올린다.
- --secrets: 아래 환경변수 중 설정된 것을 Space 비밀값으로 저장한다
  DATABASE_URL, ALLOWED_ORIGINS, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
  YOLO_BALL_MODEL
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SECRET_KEYS = ("DATABASE_URL", "ALLOWED_ORIGINS", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT",
               "R2_BUCKET", "R2_PUBLIC_URL", "YOLO_BALL_MODEL")
SKIP = {"tests", "uploads", "__pycache__", "Dockerfile", "Dockerfile.worker", "railway.toml", "Procfile",
        "runtime.txt", ".env", "README.md"}


def stage() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="hf-space-"))
    for item in (ROOT / "backend").iterdir():
        if item.name in SKIP or item.suffix in (".db", ".sqlite3"):
            continue
        dst = tmp / item.name
        if item.is_dir():
            shutil.copytree(item, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            shutil.copy2(item, dst)
    shutil.copy2(HERE / "Dockerfile", tmp / "Dockerfile")
    shutil.copy2(HERE / "README.md", tmp / "README.md")
    return tmp


def main() -> int:
    token, space = os.environ.get("HF_TOKEN"), os.environ.get("HF_SPACE")
    if not token or not space:
        print("HF_TOKEN, HF_SPACE 환경변수가 필요합니다", file=sys.stderr)
        return 2
    api = HfApi(token=token)
    api.create_repo(space, repo_type="space", space_sdk="docker", private=False, exist_ok=True)

    if "--secrets" in sys.argv:
        for key in SECRET_KEYS:
            if os.environ.get(key):
                api.add_space_secret(space, key, os.environ[key])
                print("비밀값 저장:", key)

    folder = stage()
    try:
        sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip() or "local"
        api.upload_folder(repo_id=space, repo_type="space", folder_path=str(folder),
                          commit_message=f"deploy {sha}", delete_patterns=["*"])
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    user, name = space.split("/", 1)
    print(f"배포 요청 완료: https://huggingface.co/spaces/{space}")
    print(f"API 주소: https://{user.lower()}-{name.lower().replace('_', '-')}.hf.space")
    return 0


if __name__ == "__main__":
    sys.exit(main())

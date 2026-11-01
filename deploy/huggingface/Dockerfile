# Hugging Face Spaces(무료 CPU)용 백엔드 + 영상 분석 이미지
# deploy.py가 backend/ 내용과 이 파일을 Space 저장소 최상위에 올린다 (빌드 컨텍스트 = backend/).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 user

WORKDIR /app
COPY requirements.txt requirements-worker.txt ./
# CPU용 PyTorch + YOLO. ultralytics가 끌어오는 GUI용 opencv는 headless로 교체한다.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision \
    && pip install --no-cache-dir -r requirements-worker.txt \
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir --force-reinstall --no-deps "opencv-python-headless==4.9.0.80"

# 모델 가중치는 빌드할 때 받아 둔다 (콜드스타트 단축). 실행 중 쓰기는 /tmp만 가능하다.
ENV HOME=/home/user \
    PYTHONUNBUFFERED=1 \
    YOLO_MODEL=/app/models/yolov8s.pt \
    YOLO_IMGSZ=960 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics \
    UPLOAD_DIR=/tmp/uploads
RUN mkdir -p /app/models && cd /app/models && python -c "from ultralytics import YOLO; YOLO('yolov8s.pt')"

COPY --chown=user . .
RUN chown user /app
USER user

EXPOSE 7860
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}"]

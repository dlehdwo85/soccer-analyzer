FROM python:3.11-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-worker.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 서버에서 직접 영상 분석(GPU 서버 없이)하려면 Railway 변수 ENABLE_VIDEO_ANALYSIS=1 로 빌드.
# CPU용 PyTorch + YOLO를 설치한다 (이미지 약 +1GB, 분석은 GPU보다 느림 — README 참고).
ARG ENABLE_VIDEO_ANALYSIS=0
ARG YOLO_MODEL=yolov8s.pt
ENV YOLO_MODEL=${YOLO_MODEL} YOLO_CONFIG_DIR=/app/.ultralytics
RUN if [ "$ENABLE_VIDEO_ANALYSIS" = "1" ]; then \
      pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision \
      && pip install --no-cache-dir -r requirements-worker.txt \
      && pip uninstall -y opencv-python \
      && pip install --no-cache-dir --force-reinstall --no-deps "opencv-python-headless==4.9.0.80" \
      && python -c "from ultralytics import YOLO; YOLO('${YOLO_MODEL}')"; \
    fi

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

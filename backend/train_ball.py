"""공 검출 모델 추가 학습 (GPU 서버에서 한 번 실행).

출발점: acatorcini/yolov9-soccer-ball v9b_best.pt (아마추어 측면 카메라 1080p, 3~5px 공).
우리 영상(밤 조명·높은 측면 카메라)에서 사람이 공인지 아닌지 확인한 장면으로 이어서 학습한다.
분석과 같은 조건(1080p 화면 전체 → 1280)으로 학습해야 공 크기가 맞는다.

사용 (RunPod GPU Pod, PyTorch 이미지):
  pip install "ultralytics>=8.3,<9" boto3
  python train_ball.py --data-url <데이터셋 zip 주소> --upload-onnx <결과 ONNX 업로드 주소(presigned PUT)>
      [--upload-pt <PT 업로드 주소>] [--epochs 60]
데이터셋 zip: images/{train,val}/*.jpg, labels/{train,val}/*.txt (YOLO 형식, 클래스 0 = 공)
"""
import argparse
import os
import sys
import urllib.request
import zipfile

BASE_PT = ("https://huggingface.co/acatorcini/yolov9-soccer-ball/resolve/"
           "b30df5abc9f3eda4a9d326d953be12b3541a14b4/v9b_best.pt")


def put(url: str, path: str) -> None:
    with open(path, "rb") as f:
        req = urllib.request.Request(url, data=f.read(), method="PUT",
                                     headers={"Content-Type": "application/octet-stream"})
    urllib.request.urlopen(req, timeout=600).read()
    print("올림:", path, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-url", required=True)
    ap.add_argument("--upload-onnx", required=True)
    ap.add_argument("--upload-pt")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--work", default="/workspace/balltrain")
    a = ap.parse_args()

    os.makedirs(a.work, exist_ok=True)
    os.chdir(a.work)
    if not os.path.exists("data"):
        urllib.request.urlretrieve(a.data_url, "data.zip")
        zipfile.ZipFile("data.zip").extractall("data")
    if not os.path.exists("v9b_best.pt"):
        urllib.request.urlretrieve(BASE_PT, "v9b_best.pt")
    with open("ball.yaml", "w") as f:
        f.write(f"path: {os.path.abspath('data')}\ntrain: images/train\nval: images/val\nnames:\n  0: ball\n")

    from ultralytics import YOLO
    model = YOLO("v9b_best.pt")
    # 공은 작고 화면 전체 맥락(선수 발밑)이 중요해 크게 자르는 모자이크는 약하게, 밤 조명 차이는 밝기 변형으로
    model.train(data="ball.yaml", imgsz=1280, epochs=a.epochs, batch=a.batch, patience=15,
                mosaic=0.3, scale=0.2, translate=0.05, fliplr=0.5, hsv_v=0.5, hsv_s=0.5, degrees=0,
                close_mosaic=10, lr0=0.002, warmup_epochs=1, project="runs", name="ball", exist_ok=True)
    best = "runs/ball/weights/best.pt"
    metrics = YOLO(best).val(data="ball.yaml", imgsz=1280, batch=a.batch)
    print("검증 mAP50:", metrics.box.map50, "재현율:", metrics.box.mr, "정밀도:", metrics.box.mp, flush=True)
    onnx = YOLO(best).export(format="onnx", imgsz=1280, opset=17, simplify=True, dynamic=False)
    put(a.upload_onnx, onnx)
    if a.upload_pt:
        put(a.upload_pt, best)
    return 0


if __name__ == "__main__":
    sys.exit(main())

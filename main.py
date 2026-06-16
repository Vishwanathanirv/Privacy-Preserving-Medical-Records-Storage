import os
import cv2
import math
import torch
import argparse
import numpy as np
from model.predict_model import PredictModel
import utils


def psnr(img1, img2):
    img1 = np.array(img1, dtype=np.float64)
    img2 = np.array(img2, dtype=np.float64)
    mse = np.mean((img1 - img2) ** 2)
    if mse < 1e-10:
        return 100
    return 10 * math.log10(255.0 ** 2 / mse)


def main():
    parser = argparse.ArgumentParser(description='Calculating PSNR')
    parser.add_argument('--img-size', '-size', nargs=2, default=[512, 512], type=int, help='Image size')
    parser.add_argument('--model-pth', '-model', default=r'./model_parameter/model_state.pth', type=str, help='Path to model weights')
    parser.add_argument('--img-path', '-folder', default=r'./standard_test_images', type=str, help='Path to test images')
    parser.add_argument('--mode', '-mode', default='histogram_shifting', type=str, choices=['histogram_shifting', 'expansion_embedding'], help='Embedding mode')
    parser.add_argument('--watermark-length', '-length', default=10000, type=int, help='Watermark length')

    args = parser.parse_args()

    message_to_embed = np.random.randint(0, 2, size=args.watermark_length)
    img_size = tuple(args.img_size)
    img_file_list = os.listdir(args.img_path)

    psnr_list = []

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = PredictModel(device)
    utils.load_model(args.model_pth, model)

    for idx, file_name in enumerate(img_file_list):
        print(f"Processing {idx+1}/{len(img_file_list)}: {file_name}")
        img_file = os.path.join(args.img_path, file_name)

        img = cv2.imread(img_file)
        img_resize = cv2.resize(img, img_size, interpolation=cv2.INTER_CUBIC)
        img_gray = cv2.cvtColor(img_resize, cv2.COLOR_BGR2GRAY).astype(np.float64)

        if args.mode == 'histogram_shifting':
            img_gray_embed = utils.cnn_histogram_shifting(img_gray, message_to_embed, device, model)
        elif args.mode == 'expansion_embedding':
            img_gray_embed = utils.cnn_expansion(img_gray, message_to_embed, device, model)

        psnr_list.append(round(psnr(img_gray_embed, img_gray), 2))

    print(f'CNNP PSNR = {np.mean(psnr_list):.2f}')


if __name__ == "__main__":
    main()
